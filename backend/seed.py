"""Seed the database with demo data.

Usage: python seed.py   (needs SEED_OPS_PASSWORD and SEED_CUSTOMER_PASSWORD set)

Idempotent: if any customers already exist, nothing is written.

The data has deliberate patterns for analysis:
- Duplicate orders: orders placed from the rural sites (Hosakote field office, Shirur farm)
  are queued offline and synced later; the customer retries meanwhile and the order goes
  through twice (3 times at Sundaram, once at Greenfield). orders.client_network records it.
- Wrong items: SD-TOM-AR01 (Arka Rakshak tomato seed) is repeatedly picked as okra seed.
- Delays: dispatches to Greenfield in Pune run late.
- Account health: Sundaram's interactions turn negative after the duplicates and end in a
  negative renewal conversation (status at_risk); Greenfield stays mostly positive.
"""

import os
import random
import sys
from datetime import datetime, timedelta, timezone

import bcrypt

from db import connect, db_path, init_db

TS_FORMAT = "%Y-%m-%d %H:%M:%S"  # same format as SQLite datetime('now'), UTC

# customer_since_days: how long ago the customer signed up. owner: user key of the account owner.
CUSTOMERS = {
    "sundaram": {
        "customer_code": "SUN-001", "name": "Sundaram Agro Distributors",
        "industry": "Agricultural inputs distribution", "tier": "enterprise", "region": "South India",
        "city": "Bengaluru", "state": "Karnataka", "annual_contract_value": 4200000,
        "renewal_date": "2027-01-31", "status": "at_risk", "customer_since_days": 730,
        "contact_email": "orders@sundaram-agro.example", "owner": "accounts",
    },
    "greenfield": {
        "customer_code": "GRN-002", "name": "Greenfield Seeds Co-op",
        "industry": "Farmer seed cooperative", "tier": "mid_market", "region": "West India",
        "city": "Pune", "state": "Maharashtra", "annual_contract_value": 1150000,
        "renewal_date": "2027-08-31", "status": "active", "customer_since_days": 425,
        "contact_email": "purchase@greenfield-coop.example", "owner": "accounts",
    },
}

# (key, email, full name, role, customer key). Ops users share SEED_OPS_PASSWORD.
USERS = [
    ("ops", "ops@orderwave.demo", "Meera Iyer", "ops", None),
    ("accounts", "accounts@orderwave.demo", "Rohan Kulkarni", "ops", None),
    ("sundaram", "sundaram@orderwave.demo", "Karthik Sundaram", "customer", "sundaram"),
    ("greenfield", "greenfield@orderwave.demo", "Anjali Deshpande", "customer", "greenfield"),
]

# customer key -> [(full name, title, email, phone, is_primary)]
CONTACTS = {
    "sundaram": [
        ("Karthik Sundaram", "Head of Purchasing", "karthik@sundaram-agro.example", "+91 90000 11201", 1),
        ("Lakshmi Narayan", "Finance Manager", "lakshmi@sundaram-agro.example", "+91 90000 11202", 0),
        ("Venkatesh Rao", "Field Office Supervisor, Hosakote", "venkatesh@sundaram-agro.example", "+91 90000 11203", 0),
    ],
    "greenfield": [
        ("Anjali Deshpande", "Procurement Lead", "anjali@greenfield-coop.example", "+91 90000 22301", 1),
        ("Sachin More", "Farm Operations Manager, Shirur", "sachin@greenfield-coop.example", "+91 90000 22302", 0),
    ],
}

# customer key -> {address key: (label, line1, city, state, pincode, is_default)}.
# "main" is the default warehouse; "site" is the rural site with patchy connectivity.
ADDRESSES = {
    "sundaram": {
        "main": ("Bengaluru warehouse", "Plot 14, KIADB Industrial Area, Dobbaspet", "Bengaluru", "Karnataka", "562111", 1),
        "site": ("Hosakote field office", "Survey No. 112, Old Madras Road", "Hosakote", "Karnataka", "562114", 0),
    },
    "greenfield": {
        "main": ("Pune godown", "Gat No. 45, Hadapsar Industrial Estate", "Pune", "Maharashtra", "411028", 1),
        "site": ("Shirur farm office", "Ranjangaon MIDC Road", "Shirur", "Maharashtra", "412210", 0),
    },
}

PLACEHOLDER_IMAGES = {
    "Seeds": "/static/products/seeds.svg",
    "Fertilisers": "/static/products/fertilisers.svg",
    "Crop protection": "/static/products/crop-protection.svg",
    "Equipment": "/static/products/equipment.svg",
}

# (sku, name, category, description, unit price in INR, stock)
PRODUCTS = [
    ("SD-PDY-1121", "Paddy Seed PB-1121 Basmati (10 kg)", "Seeds", "Long-grain basmati paddy, certified seed.", 1450, 320),
    ("SD-MZE-HY900", "Hybrid Maize Seed (4 kg)", "Seeds", "High-yield kharif and rabi maize hybrid.", 1890, 210),
    ("SD-TOM-AR01", "Tomato Hybrid Seed Arka Rakshak (10 g)", "Seeds", "Triple disease-resistant tomato hybrid.", 640, 450),
    ("SD-CTN-BG2", "Bt Cotton Seed BG-II (450 g)", "Seeds", "Bollgard II cotton, one packet per acre.", 864, 500),
    ("SD-OKR-HY01", "Okra Hybrid Seed (250 g)", "Seeds", "YVMV-tolerant bhindi hybrid.", 520, 380),
    ("FT-UREA-45", "Neem-Coated Urea (45 kg)", "Fertilisers", "46% nitrogen, neem coated for slow release.", 267, 1200),
    ("FT-DAP-50", "DAP 18:46:0 (50 kg)", "Fertilisers", "Di-ammonium phosphate for basal dose.", 1350, 800),
    ("FT-NPK-191919", "Water-Soluble NPK 19:19:19 (1 kg)", "Fertilisers", "Fully soluble, for drip and foliar use.", 165, 900),
    ("FT-MOP-50", "Muriate of Potash (50 kg)", "Fertilisers", "60% K2O potash fertiliser.", 1700, 400),
    ("FT-ZN-5", "Zinc Sulphate Monohydrate (5 kg)", "Fertilisers", "33% zinc for paddy and maize.", 480, 350),
    ("CP-IMD-250", "Imidacloprid 17.8% SL (250 ml)", "Crop protection", "Systemic insecticide for sucking pests.", 410, 600),
    ("CP-MNZ-1", "Mancozeb 75% WP (1 kg)", "Crop protection", "Broad-spectrum contact fungicide.", 520, 540),
    ("CP-CHL-1", "Chlorpyrifos 20% EC (1 L)", "Crop protection", "Insecticide for soil and foliar pests.", 590, 300),
    ("CP-GLY-1", "Glyphosate 41% SL (1 L)", "Crop protection", "Non-selective post-emergence herbicide.", 480, 450),
    ("CP-NEEM-1", "Neem Oil 1500 ppm (1 L)", "Crop protection", "Azadirachtin-based botanical pesticide.", 350, 700),
    ("EQ-SPR-16", "Knapsack Sprayer 16 L Manual", "Equipment", "Manual pump sprayer with brass lance.", 1450, 120),
    ("EQ-BSP-16", "Battery Sprayer 16 L", "Equipment", "12 V rechargeable sprayer, 6-8 hours per charge.", 3200, 80),
    ("EQ-DRP-KIT", "Drip Irrigation Kit (1 acre)", "Equipment", "Laterals, drippers, filter and fittings for one acre.", 18500, 25),
    ("EQ-SCK-W", "Hand Sickle with Wooden Handle", "Equipment", "Serrated carbon-steel harvesting sickle.", 180, 600),
    ("EQ-TARP-12", "HDPE Tarpaulin 12x15 ft", "Equipment", "UV-stabilised, for covering produce and stock.", 1650, 150),
]

QTY_RANGE = {"Seeds": (5, 40), "Fertilisers": (10, 60), "Crop protection": (5, 30), "Equipment": (1, 5)}

STATUS_FLOW = ["placed", "confirmed", "packed", "shipped", "delivered"]
# Hours between one status and the next. Order ages below leave room for the slowest path.
STEP_HOURS = {"confirmed": (2, 8), "packed": (18, 30), "shipped": (20, 40), "delivered": (48, 96), "cancelled": (2, 24)}


def _order(key, customer, days, minutes, status, items=None, note=None, cancelled_after=None, slow=None,
           address="main", network="good"):
    """slow overrides STEP_HOURS for this order, e.g. {"shipped": (100, 110)}.
    address is a key into ADDRESSES; network is the client_network value."""
    return {
        "key": key, "customer": customer, "ago": timedelta(days=days) - timedelta(minutes=minutes),
        "status": status, "items": items, "note": note, "cancelled_after": cancelled_after, "slow": slow or {},
        "address": address, "network": network,
    }


# Repeated item lists for the duplicate pairs (the second order is the retry).
DUP_A = [("FT-UREA-45", 60), ("FT-DAP-50", 30)]
DUP_B = [("SD-PDY-1121", 20), ("FT-ZN-5", 12), ("CP-MNZ-1", 15)]
DUP_C = [("SD-CTN-BG2", 40), ("CP-IMD-250", 20)]
DUP_D = [("FT-UREA-45", 50), ("FT-NPK-191919", 40), ("EQ-SPR-16", 3)]

HOSAKOTE = "Deliver to the Hosakote field office."
SHIRUR = "Deliver to the Shirur farm office."

# Orders oldest first. days = days ago; minutes = minutes later than that (for retries).
# items=None means pick 1-4 random products. Duplicate pairs (and their originals) were
# queued offline at a rural site; a few other site orders went through on a weak signal.
ORDERS = [
    _order("s01", "sundaram", 59, 0, "delivered"),
    _order("g01", "greenfield", 56, 0, "delivered", items=[("SD-TOM-AR01", 40), ("FT-NPK-191919", 25)]),
    _order("s02", "sundaram", 53, 0, "delivered", items=DUP_A, note=HOSAKOTE, address="site", network="offline_sync"),
    _order("s03", "sundaram", 53, 12, "delivered", items=DUP_A, note=HOSAKOTE, address="site", network="offline_sync"),
    _order("g02", "greenfield", 49, 0, "delivered"),
    _order("s04", "sundaram", 46, 0, "delivered", items=[("FT-DAP-50", 40), ("FT-UREA-45", 30)]),
    _order("g03", "greenfield", 42, 0, "delivered", items=[("EQ-BSP-16", 5), ("CP-NEEM-1", 20)],
           slow={"shipped": (100, 110)}),
    _order("s05", "sundaram", 39, 0, "delivered", items=[("SD-TOM-AR01", 25), ("CP-MNZ-1", 10)]),
    _order("g04", "greenfield", 35, 0, "delivered", note=SHIRUR, address="site", network="weak"),
    _order("s06", "sundaram", 32, 0, "delivered", items=[("CP-IMD-250", 24), ("CP-NEEM-1", 30)]),
    _order("s07", "sundaram", 28, 0, "delivered", items=DUP_B, note=HOSAKOTE, address="site", network="offline_sync"),
    _order("s08", "sundaram", 28, 9, "cancelled", items=DUP_B, cancelled_after="confirmed",
           note=HOSAKOTE, address="site", network="offline_sync"),
    _order("g05", "greenfield", 25, 0, "delivered", items=[("SD-TOM-AR01", 30), ("CP-NEEM-1", 15)]),
    _order("g06", "greenfield", 22, 0, "delivered", note="Call Ramesh (store keeper) before arrival."),
    _order("s09", "sundaram", 19, 0, "delivered", note=HOSAKOTE, address="site", network="weak"),
    _order("g07", "greenfield", 16, 0, "delivered", items=DUP_C, note=SHIRUR, address="site", network="offline_sync"),
    _order("g08", "greenfield", 16, 15, "cancelled", items=DUP_C, cancelled_after="confirmed",
           note=SHIRUR, address="site", network="offline_sync"),
    _order("s10", "sundaram", 13, 0, "delivered", note="Unload at warehouse gate 2."),
    _order("g09", "greenfield", 12, 0, "shipped", items=[("EQ-DRP-KIT", 2), ("FT-NPK-191919", 30)],
           note="Needed before sowing. " + SHIRUR, address="site", network="weak"),
    _order("s11", "sundaram", 10, 0, "delivered"),
    _order("g10", "greenfield", 8, 0, "packed", items=[("EQ-TARP-12", 12), ("EQ-SPR-16", 6)]),
    _order("s12", "sundaram", 5, 0, "shipped", note=HOSAKOTE, address="site", network="weak"),
    _order("s13", "sundaram", 3, 0, "confirmed", items=DUP_D, note=HOSAKOTE, address="site", network="offline_sync"),
    _order("s14", "sundaram", 3, 7, "confirmed", items=DUP_D, note=HOSAKOTE, address="site", network="offline_sync"),
    _order("g11", "greenfield", 1, 0, "placed"),
]

# Order key -> [(hours after the order was placed, body)]. Authors alternate customer, ops, customer, ...
MESSAGES = {
    "g09": [
        (150, "Where is this shipment? It was marked shipped almost a week ago and nobody at the transporter "
              "picks up the phone. We have labour booked to lay the drip lines on Saturday."),
        (156, "I'm sorry, I know the timing is tight. I've escalated with the transporter's Pune depot and "
              "will call you before 5 pm with a location for the truck."),
        (260, "Still nothing, and no call yesterday either. If the kits don't come by Friday we'll have to "
              "cancel and buy locally."),
    ],
    "s14": [
        (1, "Hi, this is a repeat of the order I placed a few minutes ago. The signal at the field office "
            "dropped while it was submitting. Please cancel this one."),
        (4, "Got it, thanks for telling us quickly. I'll cancel this one before it goes to packing and "
            "keep the earlier order."),
    ],
    "g01": [
        (180, "Opened the tomato seed cartons today and every packet inside is okra. The outer box says Arka "
              "Rakshak. Our nursery beds are ready and now we're stuck."),
        (185, "That's a picking mistake on our side, I'm sorry. Correct packets will go out on today's "
              "evening dispatch, and the driver will collect the okra."),
    ],
    "s04": [
        (178, "Four DAP bags came split along the seam. The driver says they were loaded under the urea."),
        (184, "Thanks for the photos. We'll credit the four bags and have raised it with the loading team."),
    ],
    "s10": [
        (200, "Just wanted to say the delivery came a day earlier than promised and the driver helped unload. Thank you!"),
        (202, "That's great to hear, I'll pass it on to the dispatch team."),
    ],
    "g10": [
        (120, "Hello, this order shows as packed since last week. Do you have a dispatch date?"),
        (124, "Checking with the warehouse now. The tarpaulins came in late from our supplier, so the whole "
              "order is waiting on them. I'll confirm a date tomorrow."),
    ],
    "s12": [
        (90, "Could you share the vehicle number and an expected arrival time? We need someone at the gate."),
    ],
}

# (order key, reporter key, category, severity, status, hours after placed, jira key, description).
# Descriptions can use {s02} etc. to refer to that order's id.
ISSUES = [
    ("s03", "sundaram", "duplicate_order", "high", "resolved", 3, "SCRUM-24",
     "Order #{s03} is a duplicate of #{s02}. I was placing it from our Hosakote field office where the signal "
     "keeps dropping. The page spun for a long time after I tapped Place order, so I tapped it again. Now both "
     "have been confirmed and we only need one lot of urea and DAP."),
    ("s08", "sundaram", "duplicate_order", "high", "resolved", 2, "SCRUM-25",
     "Same problem as last month. The network at the field office cut out halfway through checkout and the app "
     "showed an error, so I placed the order again. It went through twice. Please cancel #{s08} and keep #{s07}."),
    ("g08", "greenfield", "duplicate_order", "medium", "resolved", 1, None,
     "We were on mobile data at the Shirur farm and the order screen timed out. I tried again and it looks like "
     "both went through. Keep #{g07} and cancel #{g08}."),
    ("s14", "sundaram", "duplicate_order", "high", "open", 1, None,
     "Third time this has happened. Ordered from the field office, the connection dropped, I got a 'something "
     "went wrong' message, retried, and now there are two identical orders (#{s13} and #{s14}). Please cancel "
     "#{s14} before it is packed. Could the site warn us when the same order is placed twice?"),
    ("g01", "greenfield", "wrong_item", "medium", "resolved", 182, None,
     "Ordered 40 packets of Tomato Hybrid Seed Arka Rakshak (SD-TOM-AR01). Every packet in the cartons is okra "
     "hybrid seed. The cartons are labelled tomato but the packets inside are okra."),
    ("s05", "sundaram", "wrong_item", "high", "resolved", 178, None,
     "Our 25 packets of Arka Rakshak tomato seed (SD-TOM-AR01) turned out to be okra seed. Farmers have nursery "
     "sowing booked this week, so we need the right seed urgently."),
    ("g05", "greenfield", "wrong_item", "medium", "investigating", 180, None,
     "Wrong seed again for SD-TOM-AR01. 30 packets of tomato ordered and 12 of them are okra. This is the second "
     "time for us. Please check how this item is being picked."),
    ("g03", "greenfield", "delay", "medium", "resolved", 100, None,
     "The battery sprayers still haven't shipped four days after the order was confirmed. We need them for the "
     "spraying round on Monday."),
    ("g09", "greenfield", "delay", "high", "investigating", 200, None,
     "Drip irrigation kits were marked shipped over a week ago and have not arrived. The transporter's number "
     "goes unanswered and our labour is booked for Saturday."),
    ("g10", "greenfield", "delay", "medium", "open", 150, None,
     "Order has been sitting at packed for six days with no dispatch date. Is something holding it up?"),
    ("s04", "sundaram", "damaged", "medium", "resolved", 178, None,
     "4 of the 40 DAP bags arrived split along the seam and roughly 15 kg spilled in the truck. The driver said "
     "they were loaded underneath the urea."),
    ("s06", "sundaram", "billing", "low", "investigating", 200, None,
     "The invoice lists Imidacloprid 17.8% SL at ₹450 per bottle, but the order and the catalogue both say ₹410. "
     "For 24 bottles that's ₹960 extra."),
]

# (order key, rating, comment). Only delivered orders; the customer's user leaves the feedback.
FEEDBACK = [
    ("g01", 1, "Tomato cartons were full of okra seed. We lost a week of nursery time."),
    ("s04", 2, "Four DAP bags torn on arrival. The loading needs to be done more carefully."),
    ("s05", 1, "Okra seed instead of tomato. Very disappointing, our farmers were waiting."),
    ("g05", 2, "Part of the tomato seed was okra again. Second time for us."),
    ("s02", 3, "Products were fine, but the order went through twice and it took a week to sort out."),
    ("g03", 3, "Sprayers work well, but they shipped four days late."),
    ("s06", 3, "Goods OK. Still waiting on the corrected invoice."),
    ("s01", 5, "Everything arrived on time and well packed."),
    ("g02", 4, "Good quality. Delivery was a day later than quoted but they kept us informed."),
    ("g04", 5, "Smooth order, the driver called ahead."),
    ("g06", 4, "All good. SMS tracking updates would be nice."),
    ("s09", 5, "Quick delivery and the bags were in perfect condition."),
    ("s10", 5, "Arrived a day early and the driver helped unload. Thanks to the dispatch team."),
]

# customer key -> [(days ago, type, sentiment, order key or None, author user key, summary)], oldest first.
# Summaries can use {s03} etc. for order ids. Linked orders must be placed before the interaction.
INTERACTIONS = {
    "sundaram": [
        (88, "meeting", "positive", None, "accounts",
         "Quarterly review with Karthik at the Dobbaspet warehouse. Volumes are up about 18% on last year and "
         "they want to move most of their kharif input buying onto the portal."),
        (75, "call", "positive", None, "accounts",
         "Walked Venkatesh through ordering from the Hosakote field office on his phone. He placed a test order "
         "without help and liked that it works when the signal drops."),
        (62, "email", "neutral", None, "accounts",
         "Lakshmi asked for one consolidated invoice per month instead of one per order. Passed it to finance."),
        (52, "call", "neutral", "s03", "ops",
         "Karthik called about #{s03} going through twice from the field office. Agreed we'd take back the extra "
         "urea and DAP. Logged SCRUM-24 for the offline retry problem."),
        (37, "email", "neutral", "s04", "ops",
         "Sent the credit note for the four torn DAP bags on #{s04}. Lakshmi confirmed she received it."),
        (31, "call", "negative", "s05", "accounts",
         "Karthik was upset about okra seed in the Arka Rakshak cartons on #{s05}. Two villages had nursery "
         "sowing booked. Promised replacement seed on the evening dispatch."),
        (27, "escalation", "negative", "s08", "accounts",
         "Karthik escalated the second duplicate order (#{s08}) to our sales head. He said his field team no "
         "longer trusts the app at Hosakote and has started phoning orders in again. Linked to SCRUM-25."),
        (20, "email", "negative", "s06", "accounts",
         "Lakshmi chased the Imidacloprid invoice correction on #{s06} for the second time. Finance still "
         "hasn't issued the revised invoice."),
        (12, "meeting", "negative", None, "accounts",
         "Account review. Karthik is trialling a competing distributor portal for next season. Agreed to send "
         "a written plan for fixing duplicate orders by the end of the month."),
        (2, "renewal", "negative", "s14", "accounts",
         "Renewal call ahead of the 31 Jan 2027 date. Karthik said they won't renew on current terms unless "
         "duplicate orders stop. The third duplicate (#{s14}) came in this week. They want a 5% discount and a "
         "named support contact."),
    ],
    "greenfield": [
        (85, "meeting", "positive", None, "accounts",
         "Onboarding session with Anjali. The co-op wants all seed and crop protection buying for its 600 member "
         "farmers to go through the portal."),
        (70, "email", "positive", None, "accounts",
         "Anjali shared next season's forecast: cotton seed and drip kit volumes roughly doubling. Asked about "
         "bulk pricing on BG-II cotton."),
        (48, "call", "neutral", "g01", "ops",
         "Anjali reported okra seed in the tomato cartons on #{g01}. She was calm about it; replacement went out "
         "the same evening."),
        (40, "email", "positive", "g02", "accounts",
         "Thank-you note from Sachin: #{g02} arrived on time for top dressing and the bags were in good shape."),
        (36, "call", "negative", "g03", "ops",
         "Anjali complained that the battery sprayers on #{g03} sat at packed for four days and the co-op missed "
         "its Monday spraying round. Apologised and waived the freight charge."),
        (30, "note", "neutral", None, "accounts",
         "Greenfield asked for SMS alerts when an order is dispatched. Logged as a feature request."),
        (21, "meeting", "positive", None, "accounts",
         "Visited the Shirur farm office. Sachin is happy with crop protection pricing and wants a battery "
         "sprayer demo for member farmers."),
        (15, "call", "neutral", "g08", "ops",
         "Anjali flagged a duplicate (#{g08}) placed on mobile data at Shirur. Cancelled it within the hour; she "
         "was relaxed about it."),
        (7, "email", "neutral", "g09", "ops",
         "Sent tracking details for the drip kits on #{g09}. The transporter says the truck is at its Pune depot."),
        (4, "renewal", "positive", None, "accounts",
         "Early renewal conversation. Anjali wants to renew in August 2027 and add about 200 more member farmers. "
         "Asked for a quote on a two-year term."),
    ],
}

# (order key, sku, rating, comment). Only delivered orders and products that were on the order.
REVIEWS = [
    ("g01", "SD-TOM-AR01", 1, "The tomato cartons had okra packets inside. Can't rate the seed itself, we never got it."),
    ("s05", "SD-TOM-AR01", 2, "Got okra instead of Arka Rakshak. The replacement batch germinated well, but the mix-up cost us a week."),
    ("g05", "SD-TOM-AR01", 2, "12 of 30 packets were okra again. The genuine Arka Rakshak packets were fine."),
    ("s04", "FT-DAP-50", 2, "Good granule quality but four bags came split. Needs stronger bags."),
    ("g01", "FT-NPK-191919", 5, "Dissolves completely, no clogging in our drip lines."),
    ("s02", "FT-UREA-45", 4, "Even neem coating and no lumps. Fair price."),
    ("g03", "EQ-BSP-16", 4, "Battery lasts a full day of spraying. Delivery was slow though."),
    ("s06", "CP-IMD-250", 3, "Works on whitefly as expected. The invoice price didn't match the catalogue."),
    ("s07", "SD-PDY-1121", 5, "Good germination, around 90% in our trial beds."),
    ("g07", "SD-CTN-BG2", 5, "Even stand across the field, no complaints from members."),
    ("s06", "CP-NEEM-1", 4, "Strong smell but it works well on aphids."),
    ("g03", "CP-NEEM-1", 3, "Does the job. We'd prefer 5 L cans at our volumes."),
]


def _ts(dt: datetime) -> str:
    return dt.strftime(TS_FORMAT)


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def read_passwords() -> tuple[str, str]:
    """Return (ops password, customer password) from the environment, or exit with a clear message."""
    names = ("SEED_OPS_PASSWORD", "SEED_CUSTOMER_PASSWORD")
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        sys.exit(f"seed: missing environment variable(s): {', '.join(missing)}. "
                 "Set them (see .env.example) and run the seed again.")
    too_long = [n for n in names if len(os.environ[n].encode("utf-8")) > 72]
    if too_long:
        sys.exit(f"seed: {', '.join(too_long)} must be at most 72 bytes (bcrypt limit).")
    return os.environ[names[0]], os.environ[names[1]]


def _status_path(order: dict) -> list[str]:
    if order["status"] == "cancelled":
        stop = STATUS_FLOW.index(order["cancelled_after"])
        return STATUS_FLOW[: stop + 1] + ["cancelled"]
    return STATUS_FLOW[: STATUS_FLOW.index(order["status"]) + 1]


def seed(conn, ops_password: str, customer_password: str, now: datetime | None = None) -> bool:
    """Insert the demo data. Returns False without writing anything if customers already exist."""
    if conn.execute("SELECT 1 FROM customers LIMIT 1").fetchone():
        return False

    now = (now or datetime.now(timezone.utc)).replace(tzinfo=None, microsecond=0)
    rng = random.Random(42)  # fixed so every fresh seed produces the same data

    with conn:
        # Customers first with no owner, since the owner is a user that doesn't exist yet.
        customer_ids = {}
        for key, c in CUSTOMERS.items():
            since = now - timedelta(days=c["customer_since_days"])
            cur = conn.execute(
                "INSERT INTO customers (customer_code, name, industry, tier, region, city, state, "
                "annual_contract_value, renewal_date, status, customer_since, contact_email, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (c["customer_code"], c["name"], c["industry"], c["tier"], c["region"], c["city"], c["state"],
                 c["annual_contract_value"], c["renewal_date"], c["status"], since.strftime("%Y-%m-%d"),
                 c["contact_email"], _ts(since)),
            )
            customer_ids[key] = cur.lastrowid

        user_ids = {}
        for key, email, full_name, role, customer_key in USERS:
            password = ops_password if role == "ops" else customer_password
            cur = conn.execute(
                "INSERT INTO users (email, password_hash, full_name, role, customer_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (email, _hash(password), full_name, role,
                 customer_ids.get(customer_key), _ts(now - timedelta(days=90))),
            )
            user_ids[key] = cur.lastrowid

        conn.executemany(
            "UPDATE customers SET account_owner_id = ? WHERE id = ?",
            [(user_ids[c["owner"]], customer_ids[key]) for key, c in CUSTOMERS.items()],
        )

        for key, contacts in CONTACTS.items():
            conn.executemany(
                "INSERT INTO customer_contacts (customer_id, full_name, title, email, phone, is_primary) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                [(customer_ids[key], *contact) for contact in contacts],
            )

        address_ids = {}
        for key, addresses in ADDRESSES.items():
            for address_key, address in addresses.items():
                cur = conn.execute(
                    "INSERT INTO customer_addresses (customer_id, label, line1, city, state, pincode, is_default) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (customer_ids[key], *address),
                )
                address_ids[key, address_key] = cur.lastrowid

        products = {}
        for sku, name, category, description, price, stock in PRODUCTS:
            cur = conn.execute(
                "INSERT INTO products (sku, name, category, description, unit_price, stock, image_url) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sku, name, category, description, price, stock, PLACEHOLDER_IMAGES[category]),
            )
            products[sku] = (cur.lastrowid, price, category)

        order_ids, placed_at, delivered_at, order_skus = {}, {}, {}, {}
        for order in ORDERS:
            customer_user = user_ids[order["customer"]]
            placed = now - order["ago"]

            items = order["items"]
            if items is None:
                skus = rng.sample(list(products), rng.randint(1, 4))
                items = [(sku, rng.randint(*QTY_RANGE[products[sku][2]])) for sku in skus]
            total = round(sum(products[sku][1] * qty for sku, qty in items), 2)

            events, t, prev = [(None, "placed", customer_user, placed)], placed, "placed"
            for status in _status_path(order)[1:]:
                low, high = order["slow"].get(status, STEP_HOURS[status])
                t += timedelta(hours=rng.randint(low, high), minutes=rng.randint(0, 59))
                customer_cancelled = status == "cancelled" and order["cancelled_after"] == "placed"
                events.append((prev, status, customer_user if customer_cancelled else user_ids["ops"], t))
                prev = status
            if t > now:
                raise RuntimeError(f"order {order['key']}: status history runs past now; make it older")

            cur = conn.execute(
                "INSERT INTO orders (customer_id, placed_by, address_id, order_status, total, delivery_note, "
                "client_network, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (customer_ids[order["customer"]], customer_user, address_ids[order["customer"], order["address"]],
                 order["status"], total, order["note"], order["network"], _ts(placed), _ts(t)),
            )
            order_id = cur.lastrowid
            order_ids[order["key"]], placed_at[order["key"]] = order_id, placed
            order_skus[order["key"]] = {sku for sku, _ in items}
            if order["status"] == "delivered":
                delivered_at[order["key"]] = t

            conn.executemany(
                "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
                [(order_id, products[sku][0], qty, products[sku][1]) for sku, qty in items],
            )
            conn.executemany(
                "INSERT INTO order_events (order_id, from_status, to_status, changed_by, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                [(order_id, frm, to, by, _ts(at)) for frm, to, by, at in events],
            )

        customer_of = {o["key"]: o["customer"] for o in ORDERS}

        def after_placed(order_key: str, hours: float) -> str:
            at = placed_at[order_key] + timedelta(hours=hours)
            if at > now:
                raise RuntimeError(f"order {order_key}: entry {hours}h after placing is in the future")
            return _ts(at)

        for order_key, thread in MESSAGES.items():
            authors = (user_ids[customer_of[order_key]], user_ids["ops"])
            conn.executemany(
                "INSERT INTO order_messages (order_id, author_id, body, created_at) VALUES (?, ?, ?, ?)",
                [(order_ids[order_key], authors[i % 2], body, after_placed(order_key, hours))
                 for i, (hours, body) in enumerate(thread)],
            )

        for order_key, reporter, category, severity, status, hours, jira_key, description in ISSUES:
            conn.execute(
                "INSERT INTO issues (order_id, reported_by, category, severity, status, description, jira_key, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (order_ids[order_key], user_ids[reporter], category, severity, status,
                 description.format(**order_ids), jira_key, after_placed(order_key, hours)),
            )

        for order_key, rating, comment in FEEDBACK:
            if order_key not in delivered_at:
                raise RuntimeError(f"order {order_key}: feedback is only for delivered orders")
            left_at = min(delivered_at[order_key] + timedelta(hours=rng.randint(4, 48)), now)
            conn.execute(
                "INSERT INTO order_feedback (order_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)",
                (order_ids[order_key], user_ids[customer_of[order_key]], rating, comment, _ts(left_at)),
            )

        for key, interactions in INTERACTIONS.items():
            for days, kind, sentiment, order_key, author, summary in interactions:
                at = now - timedelta(days=days)
                if order_key and placed_at[order_key] > at:
                    raise RuntimeError(f"interaction on {order_key}: dated before the order was placed")
                conn.execute(
                    "INSERT INTO customer_interactions "
                    "(customer_id, order_id, interaction_type, summary, sentiment, created_by, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (customer_ids[key], order_ids.get(order_key), kind, summary.format(**order_ids),
                     sentiment, user_ids[author], _ts(at)),
                )

        for order_key, sku, rating, comment in REVIEWS:
            if order_key not in delivered_at or sku not in order_skus[order_key]:
                raise RuntimeError(f"review {order_key}/{sku}: must be a product on a delivered order")
            reviewed_at = min(delivered_at[order_key] + timedelta(hours=rng.randint(24, 120)), now)
            customer = customer_of[order_key]
            conn.execute(
                "INSERT INTO product_reviews (product_id, customer_id, user_id, order_id, rating, comment, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (products[sku][0], customer_ids[customer], user_ids[customer], order_ids[order_key],
                 rating, comment, _ts(reviewed_at)),
            )

    return True


def main() -> None:
    ops_password, customer_password = read_passwords()
    init_db()
    conn = connect()
    try:
        if seed(conn, ops_password, customer_password):
            print(f"Seeded demo data into {db_path()}")
        else:
            print(f"{db_path()} already has data; nothing to do.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
