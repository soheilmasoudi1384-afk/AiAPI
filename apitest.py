import json

import httpx


ACCOUNT_ID = "7b782f01fe2ef821e633008263feda7f"
MODEL = "@cf/zai-org/glm-4.7-flash"
API_TOKEN = "cfat_CwjxOJsTHgWJNXfZXpJvHElLHUhonBsKAcHpYhxK40f69f52"



def main() -> None:
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
        f"/ai/run/{MODEL}"
    )
    headers = {"Authorization": f"Bearer {API_TOKEN}"}
    payload = {
        "messages": [
            {"role": "system", "content": "You are a friendly assistant."},
            {"role": "user", "content": "Write a short story about a llama."},
        ]
    }

    response = httpx.post(url, headers=headers, json=payload, timeout=60)
    if not response.is_success:
        raise SystemExit(
            f"Cloudflare API returned HTTP {response.status_code}:\n{response.text}"
        )
    print(json.dumps(response.json(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
