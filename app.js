// Walkie-Talkie App Logic

// Data State
let channels = [
    { num: '01', name: 'Alpha Squad', freq: '462.5625 MHz' },
    { num: '02', name: 'Bravo Six', freq: '462.5875 MHz' },
    { num: '09', name: 'Emergency', freq: '462.7125 MHz' },
];
let activeChannelNum = '02';
let isTransmitting = false;
let isSignaling = false; // Prevents overlapping rapid button presses
let eqInterval;

// WebRTC / PeerJS State
let peer;
let localStream;
let activeCall = null;
const audioEl = document.getElementById('remote-audio');
let localPeerId = '';
let localNodeIndex = -1;
const MAX_NODES = 5;
let activeCalls = [];
let activeConnections = []; // Data connections for signaling

// DOM Elements
const screenRadio = document.getElementById('screen-radio');
const screenChannels = document.getElementById('screen-channels');
const screenSettings = document.getElementById('screen-settings');
const navItems = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');

const chNumDisplay = document.getElementById('current-ch-display');
const chNameDisplay = document.getElementById('current-ch-name');
const pttBtn = document.getElementById('ptt-btn');
const txIndicator = document.getElementById('tx-indicator');
const eqBars = document.querySelectorAll('.eq-bar');
const chListContainer = document.getElementById('channel-list');

const btnAddChannel = document.getElementById('btn-add-channel');
const modalOverlay = document.getElementById('modal-overlay');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const btnSaveChannel = document.getElementById('btn-save-channel');
const inputChNum = document.getElementById('new-ch-num');
const inputChName = document.getElementById('new-ch-name');
const clockEl = document.getElementById('clock');

const myPeerIdInput = document.getElementById('my-peer-id');
const callerIdDisplay = document.getElementById('caller-id-display');
const topLeftStatus = document.getElementById('top-left-status');
const myCallsignInput = document.getElementById('my-callsign-input');

// --- Audio Synthesis for Walkie-Talkie Sounds ---
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playPTTPress() {
    initAudio();
    const t = audioCtx.currentTime;
    
    // High-tech activation chirp
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);
    
    // A rapid rising dual-tone chirp
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(600, t);
    osc1.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
    
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(800, t);
    osc2.frequency.exponentialRampToValueAtTime(1600, t + 0.08);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
    gain.gain.linearRampToValueAtTime(0, t + 0.08);
    
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.08);
    osc2.stop(t + 0.08);
}

function playPTTRelease() {
    initAudio();
    const t = audioCtx.currentTime;
    
    // 1. Short crisp static burst (digital squelch)
    const bufferSize = audioCtx.sampleRate * 0.08; // 80ms
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 3000;
    
    const noiseGain = audioCtx.createGain();
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    
    noiseGain.gain.setValueAtTime(0.3, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
    noise.start(t);
    
    // 2. Modern 3-tone "K-Type" Roger Beep (e.g., Motorola style)
    const rT = t + 0.05; // start slightly before static ends
    
    function createBeep(freq, startTime, duration, vol) {
        const osc = audioCtx.createOscillator();
        const bGain = audioCtx.createGain();
        osc.connect(bGain);
        bGain.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        
        bGain.gain.setValueAtTime(0, startTime);
        bGain.gain.linearRampToValueAtTime(vol, startTime + 0.01);
        bGain.gain.setValueAtTime(vol, startTime + duration - 0.02);
        bGain.gain.linearRampToValueAtTime(0, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
    }
    
    // Beep 1
    createBeep(1000, rT, 0.06, 0.2);
    // Beep 2
    createBeep(1200, rT + 0.06, 0.06, 0.2);
    // Beep 3 (longer)
    createBeep(1500, rT + 0.12, 0.12, 0.2);
}
// ------------------------------------------------

// Init
function init() {
    updateClock();
    setInterval(updateClock, 1000);
    renderChannelList();
    updateRadioScreen();
    setupEventListeners();
    connectToChannel(activeChannelNum);
}

// --- WebRTC Setup ---
let lastConnectedChannel = null;

function connectToChannel(chNum) {
    if (chNum === lastConnectedChannel) return; // already forming mesh for this channel
    lastConnectedChannel = chNum;
    
    if (peer) {
        peer.destroy();
        peer = null;
    }
    
    myPeerIdInput.value = `SCANNING CH ${chNum}...`;
    localNodeIndex = -1;
    
    function tryNode(index) {
        if (index > MAX_NODES) {
            myPeerIdInput.value = `CH ${chNum} FULL (Try later)`;
            return;
        }
        
        // Predictable IDs based on channel number
        const testId = `tactical-comms-ch-${chNum}-node-${index}`;
        const p = new Peer(testId, { debug: 1 });
        
        p.on('open', (id) => {
            console.log('Joined channel as', id);
            peer = p;
            localNodeIndex = index;
            localPeerId = id;
            myPeerIdInput.value = `READY: CH ${chNum} (NODE ${index})`;
            setupPeerListeners(p);
        });
        
        p.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                p.destroy();
                tryNode(index + 1); // Try the next slot
            } else {
                console.error('PeerJS Error:', err);
                myPeerIdInput.value = `CONNECTION ERROR`;
            }
        });
    }
    
    tryNode(1);
}

function setupPeerListeners(p) {
    p.on('call', (call) => {
        console.log('Incoming call...', call);
        // Automatically answer the call to listen.
        // We do NOT pass our own localStream here because we only want to receive.
        // This avoids triggering microphone permission prompts on the receiver side unexpectedly.
        call.answer();
        
        call.on('stream', (remoteStream) => {
            console.log('Receiving remote stream');
            
            // Mobile browsers often block hidden <audio> tags from playing.
            // Bypassing it by routing the WebRTC stream directly into the AudioContext
            // since the AudioContext is already unlocked by the PTT presses/clicks.
            initAudio();
            try {
                const source = audioCtx.createMediaStreamSource(remoteStream);
                source.connect(audioCtx.destination);
            } catch (e) {
                console.error("Error routing stream to AudioContext", e);
                // Fallback to HTMLAudioElement
                audioEl.srcObject = remoteStream;
                audioEl.play().catch(err => console.log('Audio auto-play blocked:', err));
            }
            
            // Visual RX State
            screenRadio.classList.add('rx-active');
            txIndicator.textContent = 'RECEIVING';
            startEQ();
        });
        
        call.on('close', () => {
            console.log('Call ended');
            screenRadio.classList.remove('rx-active');
            updateRadioState();
            stopEQ();
            topLeftStatus.classList.remove('active');
        });
    });
    
    // Listen for data connections (signaling for sound effects)
    p.on('connection', (conn) => {
        conn.on('data', (data) => {
            if (data.type === 'ptt-press') {
                playPTTPress();
                callerIdDisplay.textContent = data.callerId;
                topLeftStatus.classList.add('active');
            } else if (data.type === 'ptt-release') {
                playPTTRelease();
                // Aggressively clean up UI state here as well, 
                // in case the audio call 'close' event is delayed
                screenRadio.classList.remove('rx-active');
                updateRadioState();
                stopEQ();
                topLeftStatus.classList.remove('active');
            }
        });
    });
}

async function requestMic() {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('Microphone access granted');
        } catch (err) {
            console.error('Microphone access denied or error:', err);
            alert("Microphone access is required to transmit audio.");
        }
    }
}

function updateClock() {
    const now = new Date();
    const hs = String(now.getHours()).padStart(2, '0');
    const ms = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${hs}:${ms}`;
}

// Visual Helpers
function startEQ() {
    if(eqInterval) clearInterval(eqInterval);
    eqInterval = setInterval(() => {
        eqBars.forEach(bar => {
            const height = 4 + Math.random() * 24; // 4 to 28px
            bar.style.height = `${height}px`;
        });
    }, 100);
}

function stopEQ() {
    clearInterval(eqInterval);
    eqBars.forEach(bar => {
        bar.style.height = `4px`; // reset
    });
}

function updateRadioState() {
    if(!isTransmitting && !screenRadio.classList.contains('rx-active')) {
        txIndicator.textContent = 'STANDBY';
    }
}

// Navigation
function switchScreen(targetId) {
    screens.forEach(s => s.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));
    
    document.getElementById(targetId).classList.add('active');
    document.querySelector(`[data-target="${targetId}"]`).classList.add('active');
    
    if (targetId === 'screen-radio') {
        connectToChannel(activeChannelNum);
    }
}

// Render Channels
function renderChannelList() {
    chListContainer.innerHTML = '';
    
    channels.forEach(ch => {
        const isActive = ch.num === activeChannelNum;
        const card = document.createElement('div');
        card.className = `channel-card ${isActive ? 'active' : ''}`;
        card.innerHTML = `
            <div class="ch-badge">${ch.num}</div>
            <div class="ch-info">
                <div class="ch-title">${ch.name}</div>
                <div class="ch-freq">${ch.freq}</div>
            </div>
            <div class="ch-status">
                <ion-icon name="${isActive ? 'radio-button-on' : 'radio-button-off'}"></ion-icon>
            </div>
        `;
        
        card.addEventListener('click', () => {
            activeChannelNum = ch.num;
            renderChannelList();
            updateRadioScreen();
            switchScreen('screen-radio');
        });
        
        chListContainer.appendChild(card);
    });
}

// Update Main Radio Screen
function updateRadioScreen() {
    const activeCh = channels.find(c => c.num === activeChannelNum);
    if(activeCh) {
        chNumDisplay.textContent = activeCh.num;
        chNameDisplay.textContent = activeCh.name;
    }
}

// PTT Interactions
async function startTx(e) {
    if(e) e.preventDefault(); // Prevent default mobile behaviors (like selecting text)
    if(isTransmitting || isSignaling) return;
    
    if(!peer || localNodeIndex === -1) {
        alert("Still connecting to the channel. Please wait.");
        if(e && e.type.startsWith('touch')) stopTx(); 
        return;
    }
    
    // Ensure microphone access
    await requestMic();
    if(!localStream) return; // Cannot transmit without mic
    
    isSignaling = true;
    isTransmitting = true;
    
    screenRadio.classList.remove('rx-active');
    screenRadio.classList.add('tx-active');
    pttBtn.classList.add('pressed');
    txIndicator.textContent = 'TRANSMITTING';
    
    startEQ();
    playPTTPress();
    
    // WebRTC: Broadcast to all other potential nodes in this channel
    activeCalls = [];
    activeConnections = [];
    
    for(let i=1; i<=MAX_NODES; i++) {
        if(i !== localNodeIndex) {
            const targetId = `tactical-comms-ch-${activeChannelNum}-node-${i}`;
            
            // 1. Audio Call
            const call = peer.call(targetId, localStream);
            if(call) {
                call.on('error', err => {}); // ignore unavailable errors
                activeCalls.push(call);
            }
            
            // 2. Data Connection (for signaling)
            const conn = peer.connect(targetId);
            if(conn) {
                conn.on('open', () => {
                    const callsign = myCallsignInput.value.trim() || `Node ${localNodeIndex}`;
                    conn.send({ 
                        type: 'ptt-press',
                        callerId: callsign 
                    });
                });
                conn.on('error', err => {});
                activeConnections.push(conn);
            }
        }
    }
    
    // Unlock after connection setup
    setTimeout(() => { isSignaling = false; }, 300);
}

function stopTx(e) {
    if(e) e.preventDefault();
    if(!isTransmitting || isSignaling) return;
    
    isSignaling = true;
    isTransmitting = false;
    screenRadio.classList.remove('tx-active');
    pttBtn.classList.remove('pressed');
    
    stopEQ();
    updateRadioState();
    playPTTRelease();
    
    // Signal PTT Release via Data Connections
    activeConnections.forEach(conn => {
        if(conn && conn.open) {
            conn.send({ type: 'ptt-release' });
        }
    });
    
    // End all active WebRTC Calls and Connections
    activeCalls.forEach(call => {
        if(call) call.close();
    });
    activeCalls = [];
    
    activeConnections.forEach(conn => {
        if(conn) setTimeout(() => conn.close(), 500); // Wait a bit for the release signal to send
    });
    activeConnections = [];
    
    // Unlock after tear down
    setTimeout(() => { isSignaling = false; }, 300);
}

// File/Channel/Settings Modal Interaction
function openModal() {
    // Generate next available random freq
    const randomFreq = `462.${Math.floor(Math.random() * 900) + 100} MHz`;
    inputChNum.value = '';
    inputChName.value = '';
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

function saveChannel() {
    let num = inputChNum.value.padStart(2, '0');
    let name = inputChName.value.trim();
    
    if(!num || num === '00' || !name) {
        alert("Please enter a valid channel number and callsign.");
        return;
    }
    
    // Check if exists
    if(channels.find(c => c.num === num)) {
        alert("Channel number already in use.");
        return;
    }
    
    const newCh = {
        num: num,
        name: name,
        freq: `462.${Math.floor(Math.random() * 900) + 100} MHz`
    };
    
    channels.push(newCh);
    channels.sort((a,b) => parseInt(a.num) - parseInt(b.num));
    
    activeChannelNum = num;
    renderChannelList();
    updateRadioScreen();
    closeModal();
    switchScreen('screen-radio');
}

// Setup listeners
function setupEventListeners() {
    // Nav
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            switchScreen(item.getAttribute('data-target'));
        });
    });
    
    // PTT Events (Handle both mouse and touch)
    pttBtn.addEventListener('mousedown', startTx);
    document.addEventListener('mouseup', stopTx); // Global mouse release
    
    pttBtn.addEventListener('touchstart', startTx, {passive: false});
    pttBtn.addEventListener('touchend', stopTx, {passive: false});
    pttBtn.addEventListener('touchcancel', stopTx, {passive: false});
    
    // Modal Events
    btnAddChannel.addEventListener('click', openModal);
    btnCancelModal.addEventListener('click', closeModal);
    btnSaveChannel.addEventListener('click', saveChannel);
}

// Run
document.addEventListener('DOMContentLoaded', init);
