(function () {
  var NAMES = [
    "Sentiment",
    "Fundamental",
    "Sector",
    "Trend",
    "Momentum",
    "Divergence",
    "Structure",
    "Macro",
  ];

  var list = document.querySelector("#branches");
  var tilt = document.querySelector("#tilt");
  var heartbeat = document.querySelector("#heartbeat");
  var script = document.querySelector("#script");
  var symbolInput = document.querySelector("#symbol");
  var lastPlan = null;

  function emptyReport() {
    return {
      tilt: null,
      heartbeat_at: null,
      spoken: "",
      branches: NAMES.map(function (name) {
        return { name: name, state: "empty", empty: true, reason: "no data", detail: "no data", source: "none" };
      }),
    };
  }

  function formatBerlin(iso) {
    if (!iso) return "no data";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    var formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(date);
    return formatted + " Europe/Berlin";
  }

  function render(report) {
    list.innerHTML = "";
    report.branches.forEach(function (branch) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = branch.name;
      var dot = document.createElement("span");
      dot.className = "dot " + (branch.state || "empty");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", branch.name + " " + (branch.state || "empty"));
      var copy = document.createElement("p");
      copy.className = "reason";
      var reason = branch.empty && branch.state !== "contradiction" ? "no data" : (branch.reason || "no data");
      copy.textContent = reason;
      var source = document.createElement("span");
      source.className = "source";
      var detail = branch.detail && branch.detail !== reason ? branch.detail : "";
      source.textContent = detail ? branch.source + " — " + detail : branch.source || "none";
      copy.appendChild(source);
      item.appendChild(name);
      item.appendChild(dot);
      item.appendChild(copy);
      list.appendChild(item);
    });
    if (report.tilt) {
      tilt.textContent = "Tilt: " + report.tilt.long + " long / " + report.tilt.short + " short";
    } else {
      tilt.textContent = "Tilt: no data";
    }
    heartbeat.textContent = "Last heartbeat: " + formatBerlin(report.heartbeat_at) + ".";
    script.textContent = report.spoken || "No script yet.";
  }

  async function load(event) {
    if (event) event.preventDefault();
    var symbol = symbolInput.value.trim() || "BTC/USDT";
    var headers = window.HyperSpeak.authHeaders();
    headers.Accept = "application/json";
    var response;
    try {
      response = await fetch("/api/confluence?symbol=" + encodeURIComponent(symbol), { headers: headers });
    } catch (err) {
      render(emptyReport());
      return;
    }
    if (!response.ok) {
      render(emptyReport());
      script.textContent = "No script yet. The confluence call was refused.";
      return;
    }
    var report = await response.json();
    render(report);
    if (report.spoken) {
      var planResponse = await fetch("/api/speak", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, window.HyperSpeak.authHeaders()),
        body: JSON.stringify({ text: report.spoken }),
      });
      if (planResponse.ok) {
        lastPlan = await planResponse.json();
        window.HyperSpeak.speak(lastPlan);
      }
    }
  }

  document.querySelector("#ask").addEventListener("submit", load);
  document.querySelector("#speak").addEventListener("click", function () {
    if (lastPlan) window.HyperSpeak.speak(lastPlan);
  });
  render(emptyReport());
})();
