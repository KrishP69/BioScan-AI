"""
BioScan AI — 24/7 Keep-Alive Website Ping Bot
Prevents Render free-tier web services from sleeping after 15 minutes of inactivity.
"""

import os
import sys
import time
import argparse
from datetime import datetime
import httpx

DEFAULT_RENDER_URL = os.getenv("RENDER_URL", "https://attendancesystem-ihdo.onrender.com/api/health")
DEFAULT_INTERVAL_SECONDS = int(os.getenv("PING_INTERVAL_SECONDS", "600"))  # 10 minutes

def format_timestamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def run_ping_bot(url: str, interval: int):
    # Ensure URL targets /api/health if user only passed domain
    clean_url = url.rstrip("/")
    if not clean_url.endswith("/api/health") and not clean_url.endswith("/health"):
        clean_url = f"{clean_url}/api/health"

    print("=" * 65)
    print("🚀 BioScan AI — Website Keep-Alive Ping Bot")
    print("=" * 65)
    print(f"Target URL : {clean_url}")
    print(f"Interval   : Every {interval} seconds (~{interval // 60} minutes)")
    print(f"Status     : Active & Monitoring (Press Ctrl+C to stop)")
    print("=" * 65 + "\n")

    ping_count = 0
    success_count = 0
    fail_count = 0

    headers = {
        "User-Agent": "BioScan-KeepAliveBot/1.0",
        "Accept": "application/json"
    }

    with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as client:
        while True:
            ping_count += 1
            start_time = time.time()
            ts = format_timestamp()

            try:
                response = client.get(clean_url)
                duration_ms = int((time.time() - start_time) * 1000)

                if response.status_code == 200:
                    success_count += 1
                    status_badge = "✅ [ONLINE 200 OK]"
                    details = ""
                    try:
                        res_json = response.json()
                        if "status" in res_json:
                            details = f" | System: {res_json.get('status')}"
                    except Exception:
                        pass
                    print(f"[{ts}] Ping #{ping_count} {status_badge} ({duration_ms}ms){details}")
                else:
                    fail_count += 1
                    print(f"[{ts}] Ping #{ping_count} ⚠️ [STATUS {response.status_code}] ({duration_ms}ms)")

            except httpx.ConnectTimeout:
                fail_count += 1
                print(f"[{ts}] Ping #{ping_count} ⏱️ [TIMEOUT] Server took >30s to respond (cold start waking up?)")
            except httpx.ConnectError as e:
                fail_count += 1
                print(f"[{ts}] Ping #{ping_count} ❌ [CONNECTION ERROR] Could not reach host: {e}")
            except Exception as e:
                fail_count += 1
                print(f"[{ts}] Ping #{ping_count} ❌ [ERROR] {e}")

            print(f"   ↳ Sleeping for {interval}s... (Stats: {success_count} success, {fail_count} failed)\n")
            time.sleep(interval)

def main():
    parser = argparse.ArgumentParser(description="Keep-alive ping bot for Render-hosted BioScan AI web service")
    parser.add_argument(
        "--url", "-u",
        default=DEFAULT_RENDER_URL,
        help=f"The URL of your deployed application (default: {DEFAULT_RENDER_URL})"
    )
    parser.add_argument(
        "--interval", "-i",
        type=int,
        default=DEFAULT_INTERVAL_SECONDS,
        help=f"Ping interval in seconds (default: {DEFAULT_INTERVAL_SECONDS}s / 10 mins)"
    )
    args = parser.parse_args()

    try:
        run_ping_bot(url=args.url, interval=args.interval)
    except KeyboardInterrupt:
        print("\n[Stopped] Ping bot shut down safely by user.")
        sys.exit(0)

if __name__ == "__main__":
    main()
