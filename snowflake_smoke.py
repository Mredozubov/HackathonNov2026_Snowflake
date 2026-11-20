"""Check Snowflake SQL API access with a read-only query."""

import http.client
import json
import os
import re
import sys


def main() -> int:
    host = os.environ.get("SNOWFLAKE_HOST", "").lower()
    token = os.environ.get("SNOWFLAKE_TOKEN", "")
    if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.snowflakecomputing\.com", host):
        print("Set SNOWFLAKE_HOST to your Snowflake hostname.", file=sys.stderr)
        return 1
    if not token or any(char.isspace() for char in token):
        print("Set SNOWFLAKE_TOKEN to a valid bearer token.", file=sys.stderr)
        return 1

    connection = http.client.HTTPSConnection(host, timeout=15)
    try:
        connection.request(
            "POST",
            "/api/v2/statements",
            body=json.dumps({"statement": "SELECT 1 AS CONNECTION_OK", "timeout": 10}),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        response = connection.getresponse()
        if response.status != 200:
            print(f"Snowflake returned HTTP {response.status}.", file=sys.stderr)
            return 1
        result = json.load(response)
    except (OSError, http.client.HTTPException, ValueError) as error:
        print(f"Snowflake request failed ({type(error).__name__}).", file=sys.stderr)
        return 1
    finally:
        connection.close()

    if not isinstance(result, dict) or result.get("data") not in ([["1"]], [[1]]):
        print("Snowflake returned an unexpected query result.", file=sys.stderr)
        return 1
    print("Snowflake SQL API connection verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
