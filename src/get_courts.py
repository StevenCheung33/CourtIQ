import requests

# Overpass API endpoint
url = "https://overpass.private.coffee/api/interpreter"

# Ask OpenStreetMap for basketball courts in Montgomery County
query = """
[out:json];
nwr["leisure"="pitch"]["sport"="basketball"](around:5000,39.0458,-77.0730);
out center;
"""

# Identify our application when contacting the API
headers = {
    "User-Agent": "CourtIQ/1.0 (basketball court discovery project)"
}

print("About to contact Overpass...")

try:
    response = requests.post(
        url,
        data={"data": query},
        headers=headers,
        timeout=30
    )

    print("Server responded!")
    print("Status:", response.status_code)

    # Only print the first 500 characters for now
    print(response.text[:500])

except requests.exceptions.Timeout:
    print("Request timed out.")

except requests.exceptions.RequestException as error:
    print("Request failed:", error)