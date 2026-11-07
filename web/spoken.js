/* Spoken-script hook. ElevenLabs when the server has a key, otherwise the browser voice. */
(function () {
  function authHeaders() {
    var params = new URLSearchParams(window.location.search);
    var key = params.get("key") || "";
    var headers = {};
    if (key) headers.Authorization = "Bearer " + key;
    return headers;
  }

  async function speak(plan) {
    if (!plan || !plan.text) return;
    if (plan.mode === "elevenlabs" && plan.audio_path) {
      try {
        var res = await fetch(plan.audio_path, { headers: authHeaders() });
        if (res.ok && (res.headers.get("content-type") || "").indexOf("audio") === 0) {
          var blob = await res.blob();
          var url = URL.createObjectURL(blob);
          var audio = new Audio(url);
          await audio.play();
          return;
        }
      } catch (err) {
        /* Fall through to the browser voice. */
      }
    }
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(plan.text);
    utter.lang = "en-US";
    window.speechSynthesis.speak(utter);
  }

  window.HyperSpeak = { speak: speak, authHeaders: authHeaders };
})();
