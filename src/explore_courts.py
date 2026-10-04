import json

with open("data/basketball_courts.geojson", "r") as file:
    data = json.load(file)

print(data["features"][0])