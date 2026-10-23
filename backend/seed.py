"""Seed the database with demo data.

Usage: python seed.py   (needs SEED_OPS_PASSWORD and SEED_CUSTOMER_PASSWORD set)

Idempotent: if any customers already exist, nothing is written.
"""

import os
import random
import sys
from datetime import datetime, timedelta, timezone

import bcrypt

from db import connect, db_path, init_db

TS_FORMAT = "%Y-%m-%d %H:%M:%S"  # same format as SQLite datetime('now'), UTC

CUSTOMERS = {
    "sundaram": ("Sundaram Agro Distributors", "Bengaluru", "orders@sundaram-agro.example"),
    "greenfield": ("Greenfield Seeds Co-op", "Pune", "purchase@greenfield-coop.example"),
}

# (key, email, full name, role, customer key)
USERS = [
    ("ops", "ops@orderwave.demo", "Meera Iyer", "ops", None),
    ("sundaram", "sundaram@orderwave.demo", "Karthik Sundaram", "customer", "sundaram"),
    ("greenfield", "greenfield@orderwave.demo", "Anjali Deshpande", "customer", "greenfield"),
]

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


def _order(key, customer, days, hours, status, items=None, note=None, cancelled_after=None):
    return {
        "key": key, "customer": customer, "ago": timedelta(days=days, hours=hours),
        "status": status, "items": items, "note": note, "cancelled_after": cancelled_after,
    }


# Orders oldest first. items=None means pick 1-4 random products.
ORDERS = [
    _order("s01", "sundaram", 58, 3, "delivered"),
    _order("g01", "greenfield", 55, 5, "delivered"),
    _order("s02", "sundaram", 51, 2, "delivered", items=[("FT-DAP-50", 40), ("FT-UREA-45", 60)]),
    _order("g02", "greenfield", 47, 6, "delivered"),
    _order("s03", "sundaram", 44, 4, "cancelled", cancelled_after="placed"),
    _order("g03", "greenfield", 40, 1, "delivered", items=[("SD-TOM-AR01", 30), ("CP-MNZ-1", 20)]),
    _order("s04", "sundaram", 36, 7, "delivered", note="Unload at warehouse gate 2."),
    _order("g04", "greenfield", 33, 2, "delivered"),
    _order("s05", "sundaram", 29, 5, "delivered", items=[("CP-IMD-250", 24), ("CP-NEEM-1", 30)]),
    _order("g05", "greenfield", 26, 3, "cancelled", items=[("FT-MOP-50", 30)], cancelled_after="confirmed"),
    _order("s06", "sundaram", 23, 6, "delivered"),
    _order("g06", "greenfield", 20, 4, "delivered", note="Call Ramesh (store keeper) before arrival."),
    _order("s07", "sundaram", 17, 1, "delivered"),
    _order("g07", "greenfield", 14, 16, "shipped", items=[("EQ-DRP-KIT", 2), ("EQ-BSP-16", 4)],
           note="Needed before sowing. Deliver to the Shirur farm office."),
    _order("s08", "sundaram", 12, 5, "delivered"),
    _order("g08", "greenfield", 10, 3, "delivered"),
    _order("s09", "sundaram", 8, 15, "shipped"),
    _order("g09", "greenfield", 7, 2, "shipped"),
    _order("s10", "sundaram", 5, 4, "packed"),
    _order("g10", "greenfield", 4, 14, "packed", items=[("EQ-TARP-12", 12), ("EQ-SPR-16", 6)],
           note="Deliver to Hadapsar godown, Pune 411001."),
    _order("s11", "sundaram", 3, 2, "confirmed", items=[("SD-PDY-1121", 25), ("FT-UREA-45", 50), ("FT-ZN-5", 10)]),
    # Same items placed 20 minutes after s11: the duplicate order.
    _order("s12", "sundaram", 3, 1 + 40 / 60, "confirmed",
           items=[("SD-PDY-1121", 25), ("FT-UREA-45", 50), ("FT-ZN-5", 10)]),
    _order("g11", "greenfield", 2, 6, "confirmed"),
    _order("s13", "sundaram", 1, 9, "placed"),
    _order("g12", "greenfield", 0, 5, "placed"),
]

# Order key -> [(hours after the order was placed, body)]. Authors alternate customer, ops, customer, ...
MESSAGES = {
    "s02": [
        (180, "Three of the DAP bags arrived torn and some fertiliser spilled in the truck. Raising an issue with photos."),
        (183, "Sorry about that. We've logged it and asked the transporter for their report. How many bags are affected?"),
        (185, "Three out of forty. The urea bags are all fine."),
        (200, "Thanks for confirming. Three DAP bags will be credited on your next invoice."),
    ],
    "g03": [
        (180, "We received Okra hybrid seed packets instead of Tomato Arka Rakshak."),
        (184, "Apologies, that was a picking error. Replacement tomato seed goes out today. Please keep the okra packets for pickup."),
        (186, "OK, we'll hold them at the counter."),
    ],
    "g05": [
        (1, "Please confirm all 30 bags of MOP can be dispatched this week."),
        (40, "Sorry, our MOP allocation from the supplier fell through, so we've had to cancel this order. No payment was taken."),
        (42, "Understood. Please let us know when MOP is back in stock."),
        (44, "Will do. We expect fresh stock in about two weeks."),
    ],
    "g07": [
        (150, "The shipment hasn't reached us and tracking hasn't updated in four days."),
        (153, "Checking with the transporter now and will update you today."),
        (250, "Still nothing. Sowing starts next week and we need the drip kits urgently."),
        (252, "The truck was held at a checkpost near Satara. We expect delivery within 48 hours."),
    ],
    "s09": [
        (90, "Can you share the vehicle number and expected arrival time?"),
        (92, "Vehicle KA-01-AB-4521, expected tomorrow before 6 pm."),
    ],
    "s12": [
        (3, "We placed this order twice by mistake. It's the same as the order we placed 20 minutes earlier."),
        (20, "Thanks for flagging it. We'll hold both while we check and then cancel the duplicate."),
        (22, "Thank you. Please keep the first one."),
    ],
    "g10": [
        (2, "Please deliver this to our new godown at Hadapsar."),
        (26, "The pin code on the order (411001) doesn't match Hadapsar (411028). Can you confirm the address?"),
        (30, "The correct pin is 411028. Sorry for the confusion."),
    ],
    "s13": [
        (1, "Can we add 10 more bags of urea to this order?"),
        (3, "Placed orders can't be edited. Please place a separate order and we'll ship them together."),
    ],
}

# (order key, reporter key, category, severity, status, hours after placed, description).
# Descriptions can use {s11} to refer to that order's id.
ISSUES = [
    ("s12", "sundaram", "duplicate_order", "high", "open", 2,
     "Duplicate of order #{s11}. Our purchase team submitted the same paddy seed, urea and zinc order twice "
     "within 20 minutes. Please cancel this one and keep #{s11}."),
    ("g07", "greenfield", "delay", "high", "investigating", 240,
     "Drip kits and battery sprayers were marked shipped but still haven't arrived after more than a week. "
     "We need them before sowing starts."),
    ("s02", "sundaram", "damaged", "medium", "resolved", 181,
     "3 of 40 DAP bags arrived torn with fertiliser spilled in the truck."),
    ("g03", "greenfield", "wrong_item", "medium", "resolved", 181,
     "Received 30 packets of Okra hybrid seed instead of Tomato Hybrid Seed Arka Rakshak."),
    ("s05", "sundaram", "billing", "low", "investigating", 200,
     "Invoice charges Imidacloprid 17.8% SL at ₹450 per bottle but the order price was ₹410."),
    ("g10", "ops", "other", "low", "open", 27,
     "Delivery pin code 411001 doesn't match the Hadapsar godown address (411028). Holding dispatch until confirmed."),
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
        customer_ids = {}
        for key, (name, city, email) in CUSTOMERS.items():
            created = _ts(now - timedelta(days=90))
            cur = conn.execute(
                "INSERT INTO customers (name, city, contact_email, created_at) VALUES (?, ?, ?, ?)",
                (name, city, email, created),
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

        products = {}
        for sku, name, category, description, price, stock in PRODUCTS:
            cur = conn.execute(
                "INSERT INTO products (sku, name, category, description, unit_price, stock, image_url) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sku, name, category, description, price, stock, PLACEHOLDER_IMAGES[category]),
            )
            products[sku] = (cur.lastrowid, price, category)

        order_ids, placed_at = {}, {}
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
                low, high = STEP_HOURS[status]
                t += timedelta(hours=rng.randint(low, high), minutes=rng.randint(0, 59))
                customer_cancelled = status == "cancelled" and order["cancelled_after"] == "placed"
                events.append((prev, status, customer_user if customer_cancelled else user_ids["ops"], t))
                prev = status
            if t > now:
                raise RuntimeError(f"order {order['key']}: status history runs past now; make it older")

            cur = conn.execute(
                "INSERT INTO orders (customer_id, placed_by, order_status, total, delivery_note, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (customer_ids[order["customer"]], customer_user, order["status"], total,
                 order["note"], _ts(placed), _ts(t)),
            )
            order_id = cur.lastrowid
            order_ids[order["key"]], placed_at[order["key"]] = order_id, placed

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

        for order_key, reporter, category, severity, status, hours, description in ISSUES:
            conn.execute(
                "INSERT INTO issues (order_id, reported_by, category, severity, status, description, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (order_ids[order_key], user_ids[reporter], category, severity, status,
                 description.format(**order_ids), after_placed(order_key, hours)),
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
