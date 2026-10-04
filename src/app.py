from flask import Flask, render_template
import json

app = Flask(__name__, template_folder="../templates")

@app.route("/")
def home():

    with open("data/basketball_courts.geojson", "r") as file:
        courts = json.load(file)

    return render_template("index.html", courts=courts)

if __name__ == "__main__":
    app.run(debug=True)