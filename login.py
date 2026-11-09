#!/usr/bin/env python3
"""
One-time manual login for the ChatGPT scraper.

  python login.py                  -> opens Chrome, you log in by hand, press ENTER here -> session saved
  python login.py --channel chrome -> use your installed Google Chrome instead of Playwright's Chromium
                                      (if you use it here, use the same --channel in scraper.py)

The session lives in ./browser_profile (next to this file). scraper.py opens the SAME
profile, so it starts already logged in. Do not run login.py and scraper.py at the same time.
"""
import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

URL = "https://chatgpt.com/"
PROFILE_DIR = Path(__file__).resolve().parent / "browser_profile"  # must match scraper.py


async def main(channel: str) -> None:
    PROFILE_DIR.mkdir(exist_ok=True)
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            channel=channel or None,
            no_viewport=True,
            ignore_default_args=["--enable-automation"],  # looks less like a bot (helps Google login)
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(URL)

        print("\n1) Log in to ChatGPT in the browser window that just opened.")
        print("2) Wait until you see the normal chat page (message box visible).")
        print("3) Come back HERE and press ENTER. (Don't close the browser window yourself.)\n")
        await asyncio.get_running_loop().run_in_executor(None, input)

        # quick check: reload and look for the logged-out buttons
        logged_out = False
        try:
            await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(3)
            for label in ("Log in", "Sign up for free"):
                try:
                    if await page.get_by_text(label, exact=True).first.is_visible(timeout=1500):
                        logged_out = True
                except Exception:
                    pass
        except Exception as e:
            print(f"(could not verify the login: {e})")

        try:
            await ctx.close()  # clean close = cookies are flushed to disk
        except Exception:
            pass

        if logged_out:
            print("\nWARNING: the page still shows 'Log in' / 'Sign up' - the login probably did not finish.")
            print("Run login.py again and make sure you reach the chat page before pressing ENTER.")
        else:
            print(f"\nSession saved in: {PROFILE_DIR}")
            print("Now run:  python scraper.py")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="", help='e.g. "chrome" to use installed Google Chrome')
    asyncio.run(main(ap.parse_args().channel))