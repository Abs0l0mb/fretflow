import os
import tempfile
from flask import Flask, request, send_file, jsonify

from complete_workflow import run

app = Flask(__name__)

MAX_MIDI_SIZE = 10 * 1024 * 1024  # 10 MB


@app.route("/convert", methods=["POST"])
def convert():
    if "midi" not in request.files:
        return jsonify({"error": "Missing 'midi' file in form-data"}), 400

    midi_file = request.files["midi"]
    if not midi_file.filename:
        return jsonify({"error": "Empty filename"}), 400

    midi_file.seek(0, 2)
    size = midi_file.tell()
    midi_file.seek(0)
    if size > MAX_MIDI_SIZE:
        return jsonify({"error": f"File too large (max {MAX_MIDI_SIZE // 1024 // 1024} MB)"}), 413

    step = request.form.get("step", 60, type=int)
    gpq = request.form.get("gpq", 960, type=int)
    tempo = request.form.get("tempo", 120, type=int)
    config_path = request.form.get("config", "viterbi_config.jsonc")

    with tempfile.TemporaryDirectory() as tmp:
        midi_path = os.path.join(tmp, "input.mid")
        gp5_path = os.path.join(tmp, "output.gp5")

        midi_file.save(midi_path)

        try:
            run(
                midi_path=midi_path,
                out_gp5_path=gp5_path,
                config_path=config_path,
                step=step,
                gpq=gpq,
                tempo=tempo,
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 500

        stem = os.path.splitext(midi_file.filename)[0]
        return send_file(
            gp5_path,
            as_attachment=True,
            download_name=f"{stem}.gp5",
            mimetype="application/octet-stream",
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
