
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import whisper
import torch
import os
import uuid

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL = whisper.load_model("tiny.en", device=DEVICE)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    # validate MIME
    if not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {audio.content_type}")
    
    # write to a temp file
    suffix = os.path.splitext(audio.filename)[1] or ".wav"
    tmp_path = f"/tmp/{uuid.uuid4().hex}{suffix}"
    contents = await audio.read()
    with open(tmp_path, "wb") as f:
        f.write(contents)

    # run Whisper
    result = MODEL.transcribe(tmp_path)
    # cleanup
    try:
        os.remove(tmp_path)
    except OSError:
        pass

    return {"transcript": result["text"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
