import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, CameraOff, Volume2, VolumeX, Trash2, Sparkles, 
  BookOpen, PlusCircle, RefreshCw, Layers, Activity, ChevronRight, CheckCircle2, Zap
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function App() {
  const [activeTab, setActiveTab] = useState('translate'); // 'translate', 'record', 'train', 'guide'
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  
  // Translation State
  const [predLabel, setPredLabel] = useState('Waiting for hands...');
  const [confidence, setConfidence] = useState(0);
  const [sentence, setSentence] = useState('');
  const [probs, setProbs] = useState({});
  const [bufferLen, setBufferLen] = useState(0);
  const [fps, setFps] = useState(0);
  const [hasHands, setHasHands] = useState(false);
  
  // Backend Status
  const [engineStatus, setEngineStatus] = useState(null);
  
  // Record Mode State
  const [recordWord, setRecordWord] = useState('');
  const [recordSamples, setRecordSamples] = useState(20);
  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState({ current: 0, total: 20 });
  const [recordCountdown, setRecordCountdown] = useState(null);

  // Training Mode State
  const [isTraining, setIsTraining] = useState(false);
  const [trainModelType, setTrainModelType] = useState('cnn');
  const [trainSuccess, setTrainSuccess] = useState(null);

  // Guide State
  const [selectedLetterRange, setSelectedLetterRange] = useState('A - F');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const lastFrameTimeRef = useRef(performance.now());

  // Fetch status on load
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setEngineStatus(data);
      }
    } catch (e) {
      console.warn("API status check:", e);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, []);

  // Web Speech API for offline browser TTS
  const speakWord = (text) => {
    if (!ttsEnabled || !text || text === 'idle') return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("SpeechSynthesis error:", e);
    }
  };

  // Start Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
      connectWebSocket();
    } catch (err) {
      alert("Unable to access camera: " + err.message);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
    }
    setIsCameraActive(false);
  };

  // Connect WebSocket
  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/stream`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'prediction') {
        setPredLabel(data.pred_label);
        setConfidence(data.confidence);
        setHasHands(data.has_hands);
        setBufferLen(data.buffer_len);
        setProbs(data.probs || {});
        if (data.sentence) {
          setSentence(data.sentence);
        }
        if (data.emitted) {
          speakWord(data.emitted);
          confetti({
            particleCount: 25,
            spread: 60,
            origin: { y: 0.8 }
          });
        }

        // Draw skeleton on canvas
        drawSkeleton(data.landmarks);
      }
    };

    ws.onopen = () => {
      // Start frame transmission loop (~24 FPS)
      frameIntervalRef.current = setInterval(sendFrame, 40);
    };
  };

  // Capture frame and send to backend
  const sendFrame = () => {
    if (!videoRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const video = videoRef.current;
    if (video.videoWidth === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.65);

    wsRef.current.send(JSON.stringify({ image: base64Image }));

    // Measure FPS
    const now = performance.now();
    const delta = (now - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = now;
    if (delta > 0) setFps(Math.round(1 / delta));
  };

  // Draw hand skeleton lines
  const drawSkeleton = (hands) => {
    if (!canvasRef.current || !hands) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const CONNECTIONS = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[0,17],[17,18],[18,19],[19,20]
    ];

    hands.forEach(landmarks => {
      // Draw Connections
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#06b6d4';
      CONNECTIONS.forEach(([i, j]) => {
        const pt1 = landmarks[i];
        const pt2 = landmarks[j];
        if (pt1 && pt2) {
          ctx.beginPath();
          ctx.moveTo(pt1.x * canvas.width, pt1.y * canvas.height);
          ctx.lineTo(pt2.x * canvas.width, pt2.y * canvas.height);
          ctx.stroke();
        }
      });

      // Draw Keypoints
      landmarks.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.arc(pt.x * canvas.width, pt.y * canvas.height, idx === 0 ? 6 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = idx === 0 ? '#f43f5e' : '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    });
  };

  const clearSentence = () => {
    setSentence('');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'clear_sentence' }));
    }
  };

  // Trigger Retraining
  const handleRetrain = async () => {
    setIsTraining(true);
    setTrainSuccess(null);
    try {
      const res = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_type: trainModelType })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setTrainSuccess(`Retraining succeeded! New accuracy: ${(data.val_accuracy * 100).toFixed(1)}%`);
        fetchStatus();
      }
    } catch (e) {
      alert("Retraining error: " + e.message);
    } finally {
      setIsTraining(false);
    }
  };

  const letterGroups = {
    'A - F': ['A', 'B', 'C', 'D', 'E', 'F'],
    'G - L': ['G', 'H', 'I', 'J', 'K', 'L'],
    'M - R': ['M', 'N', 'O', 'P', 'Q', 'R'],
    'S - Z': ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20">
            🤟
          </div>
          <div>
            <h1 className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              SignAI <span className="text-cyan-400 text-sm font-semibold ml-1 px-2 py-0.5 rounded-full bg-cyan-950/70 border border-cyan-800/60">STUDIO 2.0</span>
            </h1>
            <p className="text-xs text-slate-400">Real-Time Indian Sign Language & Gesture AI Engine</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1 bg-slate-800/60 p-1.5 rounded-xl border border-slate-700/50">
          {[
            { id: 'translate', label: 'Live Translation', icon: Camera },
            { id: 'record', label: 'Record New Word', icon: PlusCircle },
            { id: 'train', label: 'Retrain Studio', icon: RefreshCw },
            { id: 'guide', label: 'ISL Sign Guide', icon: BookOpen },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  active 
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Icon size={14} className={active ? 'stroke-[2.5]' : ''} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Global Controls */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={`p-2 rounded-xl border text-xs font-medium flex items-center space-x-1.5 transition-all ${
              ttsEnabled 
                ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50' 
                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>Voice {ttsEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        
        {/* ======================================================== */}
        {/* TAB 1: LIVE TRANSLATION                                  */}
        {/* ======================================================== */}
        {activeTab === 'translate' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Video Feed & Skeleton */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 shadow-2xl flex items-center justify-center group">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover transform -scale-x-100"
                  playsInline
                  muted
                />
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={480}
                  className="absolute inset-0 w-full h-full pointer-events-none transform -scale-x-100"
                />

                {!isCameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm p-6 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4 shadow-inner">
                      <Camera size={32} />
                    </div>
                    <h3 className="font-bold text-lg text-white mb-1">Webcam Feed Inactive</h3>
                    <p className="text-sm text-slate-400 max-w-sm mb-6">
                      Click start to activate real-time hand skeleton tracking and sign translation.
                    </p>
                    <button
                      onClick={startCamera}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/25 flex items-center space-x-2 transition-all transform active:scale-95"
                    >
                      <Zap size={16} className="fill-slate-950" />
                      <span>Start Live Camera</span>
                    </button>
                  </div>
                )}

                {/* Overlaid Badges */}
                {isCameraActive && (
                  <>
                    <div className="absolute top-4 left-4 flex items-center space-x-2">
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                      <span className="bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold border border-slate-700/60 text-slate-200">
                        {fps} FPS
                      </span>
                      <span className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border backdrop-blur-md ${
                        hasHands 
                          ? 'bg-cyan-950/80 border-cyan-800 text-cyan-300' 
                          : 'bg-rose-950/80 border-rose-800 text-rose-300'
                      }`}>
                        {hasHands ? 'Hands Detected' : 'No Hands'}
                      </span>
                    </div>

                    <div className="absolute bottom-4 right-4 flex items-center space-x-2">
                      <button
                        onClick={stopCamera}
                        className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-semibold backdrop-blur-md transition-all"
                      >
                        Stop Feed
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
                <div className="flex items-center space-x-3 text-xs text-slate-400">
                  <span className="font-mono">Window Buffer:</span>
                  <div className="w-24 bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/50">
                    <div 
                      className="bg-cyan-500 h-full transition-all duration-150"
                      style={{ width: `${(bufferLen / 30) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-cyan-400 font-bold">{bufferLen}/30</span>
                </div>

                <button
                  onClick={clearSentence}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all"
                >
                  <Trash2 size={13} />
                  <span>Clear Sentence</span>
                </button>
              </div>
            </div>

            {/* Right Column: Sentence Board & Live Recognition */}
            <div className="lg:col-span-5 flex flex-col space-y-4">
              
              {/* Running Translation Board */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Sparkles size={16} className="text-cyan-400" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Running Translation</h2>
                  </div>
                  <span className="text-[11px] text-slate-400">Live Transcript</span>
                </div>

                <div className="min-h-[100px] rounded-xl bg-slate-950 border border-slate-800/80 p-4 font-mono text-xl text-emerald-400 flex items-center shadow-inner tracking-wide leading-relaxed">
                  {sentence || <span className="text-slate-600 text-sm font-sans italic">Start signing in front of the camera to translate...</span>}
                </div>
              </div>

              {/* Instant Prediction Card */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl flex flex-col space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Activity size={16} className="text-blue-400" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Current Sign Match</h2>
                  </div>
                  <span className="text-[11px] font-mono text-cyan-400 font-bold">
                    {(confidence * 100).toFixed(1)}% Confidence
                  </span>
                </div>

                <div className="flex items-center justify-between bg-slate-950 border border-slate-800/80 p-4 rounded-xl">
                  <div>
                    <span className="text-xs text-slate-400 block mb-0.5">Top Predicted Token</span>
                    <span className="text-3xl font-black text-white font-mono tracking-tight">
                      {predLabel}
                    </span>
                  </div>

                  <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-300 font-mono font-bold text-2xl shadow-inner">
                    {predLabel !== 'Waiting for hands...' && predLabel !== 'No Hands' && predLabel !== 'idle' ? predLabel : '—'}
                  </div>
                </div>

                {/* Confidence Bar */}
                <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full transition-all duration-150"
                    style={{ width: `${Math.min(confidence * 100, 100)}%` }}
                  />
                </div>

                {/* Top Class Probability Distribution */}
                <div>
                  <span className="text-xs text-slate-400 block mb-2 font-medium">Top Class Probabilities</span>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(probs)
                      .filter(([k]) => k !== 'idle')
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([label, val]) => (
                        <div key={label} className="bg-slate-950/70 border border-slate-800/70 rounded-lg p-2 text-center">
                          <span className="font-mono text-xs text-slate-300 font-bold block">{label}</span>
                          <span className="text-[10px] text-cyan-400 font-mono">{(val * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: RECORD NEW WORD / GESTURE                         */}
        {/* ======================================================== */}
        {activeTab === 'record' && (
          <div className="max-w-3xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <PlusCircle size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Record Custom Word or Sign</h2>
                <p className="text-xs text-slate-400">Add dynamic phrases like "Hello", "Thank You", or custom gestures.</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-2">Word or Phrase Name</label>
                <input
                  type="text"
                  placeholder="e.g. Hello, Thank_You, Welcome, Help"
                  value={recordWord}
                  onChange={(e) => setRecordWord(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-medium text-white focus:outline-none focus:border-cyan-500 transition-all"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-2">
                  Sample Count ({recordSamples} sequences)
                </label>
                <input
                  type="range"
                  min="10"
                  max="40"
                  step="5"
                  value={recordSamples}
                  onChange={(e) => setRecordSamples(Number(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 text-xs text-slate-400 space-y-1">
                <p className="font-semibold text-slate-300">How recording works:</p>
                <p>• The system captures 30-frame temporal landmark sequences through your webcam.</p>
                <p>• A 2-second countdown guides each repetition so you can cleanly start and finish the gesture.</p>
                <p>• Samples are auto-saved to <code className="text-cyan-400">data/raw/{recordWord || '<label>'}</code> and registered in vocabulary.</p>
              </div>

              <button
                onClick={() => {
                  alert(`Please switch to Tab 1 (or the Studio Tab) with camera running, or run 'python -m src.collect --label ${recordWord || 'hello'} --samples ${recordSamples}' in terminal for high-speed hardware capture!`);
                }}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center space-x-2"
              >
                <PlusCircle size={18} />
                <span>Record Samples for "{recordWord || 'Sign'}"</span>
              </button>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: RETRAIN MODEL STUDIO                              */}
        {/* ======================================================== */}
        {activeTab === 'train' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    <RefreshCw size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Model Retraining Studio</h2>
                    <p className="text-xs text-slate-400">One-click CPU training across all active dataset tokens.</p>
                  </div>
                </div>

                <button
                  onClick={handleRetrain}
                  disabled={isTraining}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-400 hover:to-cyan-300 disabled:opacity-50 text-slate-950 font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center space-x-2"
                >
                  <RefreshCw size={16} className={isTraining ? 'animate-spin' : ''} />
                  <span>{isTraining ? 'Training in Progress...' : 'Start Training Run'}</span>
                </button>
              </div>

              {trainSuccess && (
                <div className="mb-6 p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-sm flex items-center space-x-2">
                  <CheckCircle2 size={18} />
                  <span>{trainSuccess}</span>
                </div>
              )}

              {/* Dataset Inventory Cards */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Classes in Dataset</h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-9 gap-2">
                  {engineStatus?.classes_count && Object.entries(engineStatus.classes_count).map(([cls, count]) => (
                    <div key={cls} className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-center">
                      <span className="font-mono text-sm font-bold text-white block">{cls}</span>
                      <span className="text-[10px] text-slate-400">{count} samples</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: ISL SIGN GUIDE                                    */}
        {/* ======================================================== */}
        {activeTab === 'guide' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Indian Sign Language Reference Guide</h2>
                <p className="text-xs text-slate-400">Visual cards showing canonical two-handed and single-handed signs.</p>
              </div>

              {/* Group Selector */}
              <div className="flex space-x-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                {Object.keys(letterGroups).map(group => (
                  <button
                    key={group}
                    onClick={() => setSelectedLetterRange(group)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      selectedLetterRange === group 
                        ? 'bg-cyan-500 text-slate-950' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </div>

            {/* Letter Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {letterGroups[selectedLetterRange].map(char => (
                <div key={char} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg group hover:border-cyan-500/50 transition-all">
                  <div className="aspect-[4/3] bg-slate-950 overflow-hidden relative">
                    <img
                      src={`/dataset/Letters/${char}.jpg`}
                      alt={`Sign ${char}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300"
                    />
                    <div className="absolute top-2 left-2 bg-slate-950/80 backdrop-blur-md px-2.5 py-0.5 rounded-md font-mono font-bold text-xs text-cyan-400 border border-slate-700">
                      Sign {char}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
