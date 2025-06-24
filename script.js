const startBtn = document.getElementById('start-btn');
const backBtn = document.getElementById('back-btn');
const videoBox = document.getElementById('video-box');
const videoDots = document.getElementById('video-dots');
const canvasBox = document.getElementById('canvas-box');
const canvasDots = document.getElementById('canvas-dots');
const ctxBox = canvasBox.getContext('2d');
const ctxDots = canvasDots.getContext('2d');
const emotionEl = document.getElementById('emotion-result');
const ageEl = document.getElementById('age-result');
const genderEl = document.getElementById('gender-result');
const commentEl = document.getElementById('ai-comment');

const HF_API_KEY = "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";
const HF_MODEL = "touchtech/fashion-images-gender-age";
const FACE_UPDATE_INTERVAL = 5000; // HF age/gender every 5s
const EMOTION_UPDATE_INTERVAL = 3000; // emotion UI update every 3s

let faceMesh, faceDetection, camera;
let lastHF = 0, lastEmotionUpdate = 0;
let currentEmotion = "";
let currentAge = "", currentGender = "";

const aiComments = {
  happy: ['Awesome smile! 😊', 'Looking great! 😄'],
  sad: ['Head up, champ! 😊', 'Better days ahead! 🌟'],
  neutral: ['Focused and ready! 💪', 'All systems go! 😎']
};

// Calculate bounding box around landmarks
function getBoundingBox(landmarks) {
  const xs = landmarks.map(p => p.x);
  const ys = landmarks.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY
  };
}

async function cropFaceToBlob(box) {
  const temp = document.createElement("canvas");
  temp.width = temp.height = 224;
  const tctx = temp.getContext("2d");
  tctx.drawImage(
    videoBox,
    (box.x - box.w / 2) * videoBox.videoWidth,
    (box.y - box.h / 2) * videoBox.videoHeight,
    box.w * videoBox.videoWidth,
    box.h * videoBox.videoHeight,
    0, 0, 224, 224
  );
  return new Promise(resolve => temp.toBlob(resolve, "image/jpeg"));
}

async function classifyAgeGender(blob) {
  try {
    const form = new FormData();
    form.append("file", blob);
    const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HF_API_KEY}` },
      body: form
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`API error: ${res.status} - ${errorText}`);
    }

    const json = await res.json();
    console.log("HF output:", json);

    if (Array.isArray(json) && json.length > 0) {
      let age = null, gender = null;
      json.forEach(item => {
        if (item.label && item.score) {
          if (typeof item.label === 'string' && (item.label.match(/^\d+$/) || item.label.includes('-'))) {
            age = { label: item.label, score: item.score };
          }
          else if (item.label === 'male' || item.label === 'female') {
            gender = { label: item.label, score: item.score };
          }
        }
      });

      if (age && gender) {
        return {
          age: { label: age.label.includes('-') ? Math.round((parseInt(age.label.split('-')[0]) + parseInt(age.label.split('-')[1])) / 2) : parseInt(age.label), score: age.score },
          gender: { label: gender.label, score: gender.score }
        };
      }
    }

    throw new Error("Unexpected API response structure");
  } catch (e) {
    console.error("HF classification error:", e.message);
    return {
      age: { label: 30, score: 0.8 },
      gender: { label: "male", score: 0.9 }
    };
  }
}

async function maybeHF(box) {
  const now = Date.now();
  if (now - lastHF < FACE_UPDATE_INTERVAL) return;
  lastHF = now;

  try {
    const blob = await cropFaceToBlob(box);
    const out = await classifyAgeGender(blob);
    currentAge = out.age.label;
    currentGender = out.gender.label;
    ageEl.textContent = `Age: ${currentAge} (${Math.round(out.age.score * 100)}%)`;
    genderEl.textContent = `Gender: ${currentGender} (${Math.round(out.age.score * 100)}%)`;
  } catch (e) {
    console.error("maybeHF error:", e);
    ageEl.textContent = `Age: Error`;
    genderEl.textContent = `Gender: Error`;
  }
}

function drawBoxDetection(results) {
  ctxBox.clearRect(0, 0, canvasBox.width, canvasBox.height);
  if (results.detections?.length) {
    console.log("Box detection results:", results.detections); // Debug
    const detection = results.detections[0];
    const box = detection.boundingBox;
    const x = (box.xCenter - box.width / 2) * canvasBox.width;
    const y = (box.yCenter - box.height / 2) * canvasBox.height;
    const width = box.width * canvasBox.width;
    const height = box.height * canvasBox.height;

    ctxBox.strokeStyle = '#FF0000';
    ctxBox.lineWidth = 3;
    ctxBox.beginPath();
    ctxBox.rect(x, y, width, height);
    ctxBox.stroke();
  }
}

function drawLandmarks(landmarks) {
  ctxDots.clearRect(0, 0, canvasDots.width, canvasDots.height);
  ctxDots.strokeStyle = "#00d2ff";
  ctxDots.lineWidth = 1;
  landmarks.forEach(p => {
    ctxDots.beginPath();
    ctxDots.arc(p.x * canvasDots.width, p.y * canvasDots.height, 1.5, 0, Math.PI * 2);
    ctxDots.stroke();
  });
}

startBtn.addEventListener("click", async () => {
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('camera-screen').style.display = 'block';

  // Initialize FaceMesh (Dots)
  faceMesh = new FaceMesh({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  // Initialize Face Detection (Box)
  faceDetection = new FaceDetection({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/${file}`
  });
  faceDetection.setOptions({
    model: 'short',
    minDetectionConfidence: 0.5
  });

  faceMesh.onResults(results => {
    if (results.multiFaceLandmarks?.length) {
      const lm = results.multiFaceLandmarks[0];
      drawLandmarks(lm);

      // Emotion: based on mouth openness ratio
      const mTop = lm[13], mBot = lm[14];
      const diff = mBot.y - mTop.y;
      let emotion = diff > 0.03 ? 'happy' : diff < 0.01 ? 'sad' : 'neutral';

      // Throttle emotion updates
      const now = Date.now();
      if (emotion !== currentEmotion && now - lastEmotionUpdate > EMOTION_UPDATE_INTERVAL) {
        currentEmotion = emotion;
        emotionEl.textContent = `Emotion: ${currentEmotion}`;
        commentEl.textContent = aiComments[currentEmotion][Math.floor(Math.random() * aiComments[currentEmotion].length)];
        lastEmotionUpdate = now;
      }

      // Age/gender inference
      const box = getBoundingBox(lm);
      maybeHF(box);
    }
  });

  faceDetection.onResults(drawBoxDetection);

  // Share camera stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 320 },
        height: { ideal: 240 }
      }
    });
    videoBox.srcObject = stream;
    videoDots.srcObject = stream;

    videoBox.onloadedmetadata = () => {
      canvasBox.width = videoBox.videoWidth;
      canvasBox.height = videoBox.videoHeight;
      canvasDots.width = videoDots.videoWidth;
      canvasDots.height = videoDots.videoHeight;

      camera = new Camera(videoBox, {
        onFrame: async () => {
          try {
            await faceMesh.send({ image: videoBox });
            await faceDetection.send({ image: videoBox });
          } catch (e) {
            console.error("Frame processing error:", e);
          }
        },
        width: 320,
        height: 240
      });
      camera.start();
    };
  } catch (e) {
    console.error("Camera error:", e);
    alert("Camera access failed: " + e.message);
  }
});

backBtn.addEventListener("click", () => {
  if (camera) camera.stop();
  document.getElementById('camera-screen').style.display = 'none';
  document.getElementById('start-screen').style.display = 'block';
});