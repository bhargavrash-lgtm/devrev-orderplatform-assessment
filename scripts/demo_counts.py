"""Print what's in the demo database, to compare with the README after a reset.

Usage: backend/.venv/Scripts/python.exe scripts/demo_counts.py [path/to/data.db]
Opens the database read-only and prints counts only (no names of people, no secrets).
"""

import sqlite3
import sys
from pathlib import Path

DB = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "backend" / "data.db"


def main() -> None:
    if not DB.is_file():
        sys.exit(f"No database at {DB}")
    conn = sqlite3.connect(DB.resolve().as_uri() + "?mode=ro", uri=True)
    one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    grouped = lambda sql: ", ".join(f"{k} {v}" for k, v in conn.execute(sql))  # noqa: E731

    print(f"Demo data in {DB}")
    print(f"  customers     {one('SELECT COUNT(*) FROM customers')}  ({grouped('SELECT customer_code, status FROM customers ORDER BY customer_code')})")
    print(f"  users         {one('SELECT COUNT(*) FROM users')}  ({grouped('SELECT role, COUNT(*) FROM users GROUP BY role')})")
    print(f"  products      {one('SELECT COUNT(*) FROM products')}")
    print(f"  orders        {one('SELECT COUNT(*) FROM orders')}  ({grouped('SELECT order_status, COUNT(*) FROM orders GROUP BY 1 ORDER BY 1')})")
    print(f"  issues        {one('SELECT COUNT(*) FROM issues')}  by status: {grouped('SELECT status, COUNT(*) FROM issues GROUP BY 1 ORDER BY 1')}")
    print(f"                by category: {grouped('SELECT category, COUNT(*) FROM issues GROUP BY 1 ORDER BY 2 DESC, 1')}")
    print(f"  interactions  {one('SELECT COUNT(*) FROM customer_interactions')}  ({grouped('SELECT sentiment, COUNT(*) FROM customer_interactions GROUP BY 1 ORDER BY 1')})")
    print(f"  reviews       {one('SELECT COUNT(*) FROM product_reviews')}")
    print(f"  feedback      {one('SELECT COUNT(*) FROM order_feedback')}")
    print(f"  messages      {one('SELECT COUNT(*) FROM order_messages')}")
    print(f"  attachments   {one('SELECT COUNT(*) FROM attachments')}")
    conn.close()


if __name__ == "__main__":
    main()
