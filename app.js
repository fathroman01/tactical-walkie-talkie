// Walkie-Talkie App Logic

// Data State
let channels = [];
for (let i = 1; i <= 20; i++) {
    channels.push({
        num: String(i).padStart(2, '0'),
        name: `Channel ${String(i).padStart(2, '0')}`,
        freq: `462.${2500 + i * 25} MHz`
    });
}
let activeChannelNum = '02';
let isTransmitting = false;
let isSignaling = false; // Prevents overlapping rapid button presses
let eqAnimFrame;
let currentAnalyser = null;
let localAudioSource = null;

// WebRTC / PeerJS State
let peer;
let localStream;
let activeCall = null;
const audioEl = document.getElementById('remote-audio');
let localPeerId = '';
let localNodeIndex = -1;
const MAX_NODES = 5;
let activeCalls = [];
let activeConnections = []; // Data connections for signaling (PTT)
let activeUsers = {};
let presenceInterval;
let presenceConnections = {};

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
const btnSaveCallsign = document.getElementById('btn-save-callsign');
const avatarOptions = document.querySelectorAll('.avatar-option');
let currentAvatar = '👨‍🚀';

const btnChUp = document.getElementById('btn-ch-up');
const btnChDown = document.getElementById('btn-ch-down');

const modalPinOverlay = document.getElementById('pin-modal-overlay');
const btnCancelPin = document.getElementById('btn-cancel-pin');
const btnSubmitPin = document.getElementById('btn-submit-pin');
const inputPin = document.getElementById('ch-pin-input');
let pendingChannelSelect = null;

const modalChannelActionOverlay = document.getElementById('channel-action-modal-overlay');
const actionModalCh = document.getElementById('action-modal-ch');
const actionModalName = document.getElementById('action-modal-name');
const btnActionInfo = document.getElementById('btn-action-info');
const btnActionJoin = document.getElementById('btn-action-join');
const btnCancelAction = document.getElementById('btn-cancel-action');
let selectedChannelForAction = null;

const btnActiveUsers = document.getElementById('active-users-count');
const countText = document.getElementById('active-count-text');
const modalUsersOverlay = document.getElementById('users-modal-overlay');
const btnCloseUsersModal = document.getElementById('btn-close-users-modal');
const activeUsersList = document.getElementById('active-users-list');
const usersModalCh = document.getElementById('users-modal-ch');

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
    // Load saved callsign if any
    const savedCallsign = localStorage.getItem('tactical_callsign');
    if (savedCallsign) {
        myCallsignInput.value = savedCallsign;
    }
    
    // Load saved avatar if any
    const savedAvatar = localStorage.getItem('tactical_avatar');
    if (savedAvatar) {
        currentAvatar = savedAvatar;
        avatarOptions.forEach(opt => {
            if(opt.getAttribute('data-avatar') === currentAvatar) {
                opt.classList.add('active');
            } else {
                opt.classList.remove('active');
            }
        });
    }
    
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
            
            activeUsers = {};
            activeUsers[localNodeIndex] = {
                callsign: myCallsignInput.value.trim() || 'Operator',
                avatar: currentAvatar,
                isSpeaking: false,
                isMe: true,
                lastSeen: Date.now()
            };
            if (activeChannelNum === chNum) updateActiveUsersUI();
            
            setupPeerListeners(p);
            
            Object.values(presenceConnections).forEach(c => { if(c && c.close) c.close(); });
            presenceConnections = {};
            if (presenceInterval) clearInterval(presenceInterval);
            presenceInterval = setInterval(() => broadcastHeartbeat(chNum), 3000);
            broadcastHeartbeat(chNum);
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
            
            // Ensure audio plays out loud by attaching to an HTML Audio Element First
            let tempAudioEl = document.getElementById(`audio-${call.peer}`);
            if (!tempAudioEl) {
                tempAudioEl = document.createElement('audio');
                tempAudioEl.id = `audio-${call.peer}`;
                tempAudioEl.autoplay = true;
                // Add it to the DOM so the browser respects it
                document.body.appendChild(tempAudioEl);
            }
            tempAudioEl.srcObject = remoteStream;
            tempAudioEl.play().catch(err => console.log('Audio auto-play blocked:', err));

            // Then route through AudioContext strictly for visualization EQ
            initAudio();
            try {
                // We use createMediaElementSource instead of MediaStreamSource to avoid muting
                const source = audioCtx.createMediaStreamSource(remoteStream);
                currentAnalyser = audioCtx.createAnalyser();
                currentAnalyser.fftSize = 64;
                source.connect(currentAnalyser);
                // Do NOT connect currentAnalyser.connect(audioCtx.destination) because 
                // the HTMLAudioElement is already playing it, connecting it again would cause an echo!
            } catch (e) {
                console.error("Error routing stream to AudioContext", e);
            }
            
            // Visual RX State
            screenRadio.classList.add('rx-active');
            txIndicator.textContent = 'RECEIVING';
            startEQ();
        });
        
        call.on('close', () => {
            console.log('Call ended');
            
            // Cleanup the temporary audio element
            const tempAudioEl = document.getElementById(`audio-${call.peer}`);
            if (tempAudioEl) {
                tempAudioEl.pause();
                tempAudioEl.srcObject = null;
                tempAudioEl.remove();
            }
            screenRadio.classList.remove('rx-active');
            updateRadioState();
            stopEQ();
            topLeftStatus.classList.remove('active');
        });
    });
    
    // Listen for data connections (signaling for sound effects)
    p.on('connection', (conn) => {
        conn.on('data', (data) => {
            let nodeIndex = -1;
            const match = conn.peer.match(/node-(\d+)$/);
            if (match) nodeIndex = parseInt(match[1]);

            if (data.type === 'heartbeat') {
                if (nodeIndex !== -1) {
                    activeUsers[nodeIndex] = {
                        callsign: data.callsign,
                        avatar: data.avatar || '👤',
                        isSpeaking: data.isSpeaking,
                        isMe: false,
                        lastSeen: Date.now()
                    };
                    updateActiveUsersUI();
                }
            } else if (data.type === 'ptt-press') {
                playPTTPress();
                callerIdDisplay.textContent = data.callerId || (activeUsers[nodeIndex] ? activeUsers[nodeIndex].callsign : 'Unknown');
                topLeftStatus.classList.add('active');
                if (nodeIndex !== -1 && activeUsers[nodeIndex]) {
                    activeUsers[nodeIndex].isSpeaking = true;
                    updateActiveUsersUI();
                }
            } else if (data.type === 'ptt-release') {
                playPTTRelease();
                // Aggressively clean up UI state here as well, 
                // in case the audio call 'close' event is delayed
                screenRadio.classList.remove('rx-active');
                updateRadioState();
                stopEQ();
                topLeftStatus.classList.remove('active');
                if (nodeIndex !== -1 && activeUsers[nodeIndex]) {
                    activeUsers[nodeIndex].isSpeaking = false;
                    updateActiveUsersUI();
                }
            }
        });
    });
}

function broadcastHeartbeat(chNum) {
    if (!peer || peer.disconnected) return;
    
    const myCallsign = myCallsignInput.value.trim() || 'Operator';
    activeUsers[localNodeIndex] = {
        callsign: myCallsign,
        avatar: currentAvatar,
        isSpeaking: isTransmitting,
        isMe: true,
        lastSeen: Date.now()
    };
    
    const now = Date.now();
    let changed = false;
    for (const [nodeId, user] of Object.entries(activeUsers)) {
        if (!user.isMe && now - user.lastSeen > 10000) {
            delete activeUsers[nodeId];
            changed = true;
        }
    }
    if (changed) updateActiveUsersUI();
    
    for (let i = 1; i <= MAX_NODES; i++) {
        if (i !== localNodeIndex) {
            let conn = presenceConnections[i];
            if (!conn || !conn.open) {
                const targetId = `tactical-comms-ch-${chNum}-node-${i}`;
                conn = peer.connect(targetId);
                presenceConnections[i] = conn;
                conn.on('open', () => {
                    conn.send({ type: 'heartbeat', callsign: myCallsign, avatar: currentAvatar, isSpeaking: isTransmitting });
                });
            } else {
                conn.send({ type: 'heartbeat', callsign: myCallsign, avatar: currentAvatar, isSpeaking: isTransmitting });
            }
        }
    }
}

function updateActiveUsersUI() {
    if (!countText || !activeUsersList) return;
    
    const users = Object.values(activeUsers).filter(u => u && (u.isMe || (Date.now() - u.lastSeen <= 10000)));
    countText.textContent = `${users.length} Online`;
    
    activeUsersList.innerHTML = '';
    users.forEach(u => {
        const item = document.createElement('div');
        item.className = `user-list-item ${u.isMe ? 'is-me' : ''} ${u.isSpeaking ? 'is-speaking' : ''}`;
        
        let badges = '';
        if (u.isSpeaking) badges += `<span class="badge speaking">TX</span>`;
        if (u.isMe) badges += `<span class="badge me">YOU</span>`;
        
        item.innerHTML = `
            <div class="user-info-row" style="display: flex; align-items: center; gap: 10px;">
                <div class="user-avatar" style="font-size: 20px;">${u.avatar || '👤'}</div>
                <div class="user-name">${u.callsign}</div>
            </div>
            <div class="user-badges">${badges}</div>
        `;
        activeUsersList.appendChild(item);
    });
}

async function requestMic() {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('Microphone access granted');
            
            initAudio();
            localAudioSource = audioCtx.createMediaStreamSource(localStream);
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
    if(eqAnimFrame) cancelAnimationFrame(eqAnimFrame);
    
    const dataArray = currentAnalyser ? new Uint8Array(currentAnalyser.frequencyBinCount) : null;
    let lastAnimTime = 0;
    
    function renderFrame(time) {
        if (!isTransmitting && !screenRadio.classList.contains('rx-active')) return;
        eqAnimFrame = requestAnimationFrame(renderFrame);
        
        // Throttling for a slightly retro LCD feel
        if (time - lastAnimTime < 60) return;
        lastAnimTime = time;
        
        // Compute Volume
        let vol = 0;
        if (currentAnalyser && dataArray) {
            currentAnalyser.getByteFrequencyData(dataArray);
            let sum = 0;
            // Only average the lower frequencies where the human voice usually is (e.g. first 20 bins)
            let voiceBins = Math.min(20, dataArray.length);
            for(let i = 0; i < voiceBins; i++) {
                sum += dataArray[i];
            }
            vol = sum / voiceBins; 
        }
        
        // Scale and Static threshold
        if (vol < 15) { // raised threshold slightly to ignore static/background noise
            eqBars.forEach(bar => bar.style.height = `4px`);
        } else {
            // Apply easing/damping: vol is max 255, we want max height around 28px.
            // A non-linear scale helps voice range stand out without clipping to maximum.
            const normalizedVol = Math.sqrt(vol / 255); // 0.0 to 1.0 curve
            
            eqBars.forEach((bar, index) => {
                // Add minor variation between bars instead of completely random height
                const barVariation = 1 + (Math.sin(time/200 + index) * 0.3); // +/- 30% variation
                const height = 4 + (normalizedVol * 24 * barVariation); 
                
                bar.style.height = `${Math.min(height, 28)}px`; // clamp max 28px
            });
        }
    }
    eqAnimFrame = requestAnimationFrame(renderFrame);
}

function stopEQ() {
    if(eqAnimFrame) cancelAnimationFrame(eqAnimFrame);
    currentAnalyser = null;
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
            selectedChannelForAction = ch;
            if (actionModalCh) actionModalCh.textContent = ch.num;
            if (actionModalName) actionModalName.textContent = ch.name;
            if (modalChannelActionOverlay) modalChannelActionOverlay.classList.add('show');
        });
        
        chListContainer.appendChild(card);
    });
}

function attemptChannelSwitch(targetChNum) {
    if (targetChNum === '10') {
        pendingChannelSelect = targetChNum;
        if (inputPin) inputPin.value = '';
        if (modalPinOverlay) modalPinOverlay.classList.add('show');
    } else {
        executeChannelSwitch(targetChNum);
    }
}

function executeChannelSwitch(targetChNum) {
    activeChannelNum = targetChNum;
    renderChannelList();
    updateRadioScreen();
    switchScreen('screen-radio');
    connectToChannel(activeChannelNum);
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
    
    if (localAudioSource) {
        currentAnalyser = audioCtx.createAnalyser();
        currentAnalyser.fftSize = 64;
        try { localAudioSource.disconnect(); } catch(e) {}
        localAudioSource.connect(currentAnalyser);
    }
    
    isSignaling = true;
    isTransmitting = true;
    
    if (activeUsers[localNodeIndex]) {
        activeUsers[localNodeIndex].isSpeaking = true;
        updateActiveUsersUI();
    }
    
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
    
    if (activeUsers[localNodeIndex]) {
        activeUsers[localNodeIndex].isSpeaking = false;
        updateActiveUsersUI();
    }
    
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
    connectToChannel(activeChannelNum);
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
    
    // Save Callsign Event
    if(btnSaveCallsign) {
        btnSaveCallsign.addEventListener('click', () => {
            const newName = myCallsignInput.value.trim() || 'Operator';
            localStorage.setItem('tactical_callsign', newName);
            myCallsignInput.value = newName; // clean up spaces
            
            if (activeUsers[localNodeIndex]) {
                activeUsers[localNodeIndex].callsign = newName;
                updateActiveUsersUI();
            }
            
            const originalText = btnSaveCallsign.textContent;
            btnSaveCallsign.textContent = 'SAVED!';
            btnSaveCallsign.style.background = 'var(--neon-green)';
            btnSaveCallsign.style.color = '#000';
            
            // Save Avatar as well on Save button click
            localStorage.setItem('tactical_avatar', currentAvatar);
            
            setTimeout(() => {
                btnSaveCallsign.textContent = originalText;
                btnSaveCallsign.style.background = '';
                btnSaveCallsign.style.color = '';
            }, 1500);
        });
    }

    if (btnActiveUsers) {
        btnActiveUsers.addEventListener('click', () => {
            if (usersModalCh) usersModalCh.textContent = activeChannelNum;
            if (modalUsersOverlay) modalUsersOverlay.classList.add('show');
            updateActiveUsersUI();
        });
    }
    
    // Avatar Selection Event
    avatarOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            avatarOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            currentAvatar = opt.getAttribute('data-avatar');
            
            // Instantly update my own presence locally
            if (activeUsers[localNodeIndex]) {
                activeUsers[localNodeIndex].avatar = currentAvatar;
                updateActiveUsersUI();
            }
        });
    });

    if (btnCloseUsersModal) {
        btnCloseUsersModal.addEventListener('click', () => {
            if (modalUsersOverlay) modalUsersOverlay.classList.remove('show');
        });
    }

    if (btnChUp) {
        btnChUp.addEventListener('click', () => {
            if (isTransmitting || isSignaling) return;
            let currentIndex = channels.findIndex(c => c.num === activeChannelNum);
            let nextCh = (currentIndex < channels.length - 1) ? channels[currentIndex + 1].num : channels[0].num;
            attemptChannelSwitch(nextCh);
        });
    }

    if (btnChDown) {
        btnChDown.addEventListener('click', () => {
            if (isTransmitting || isSignaling) return;
            let currentIndex = channels.findIndex(c => c.num === activeChannelNum);
            let prevCh = (currentIndex > 0) ? channels[currentIndex - 1].num : channels[channels.length - 1].num;
            attemptChannelSwitch(prevCh);
        });
    }

    if (btnCancelPin) {
        btnCancelPin.addEventListener('click', () => {
            if (modalPinOverlay) modalPinOverlay.classList.remove('show');
            
            if (pendingChannelSelect) {
                // Find next channel and switch to it
                let currentIndex = channels.findIndex(c => c.num === pendingChannelSelect);
                let nextCh = (currentIndex < channels.length - 1) ? channels[currentIndex + 1].num : channels[0].num;
                pendingChannelSelect = null;
                attemptChannelSwitch(nextCh);
            }
        });
    }

    if (btnSubmitPin) {
        btnSubmitPin.addEventListener('click', () => {
            const enteredPin = inputPin.value.trim();
            if (enteredPin === '1122') {
                if (modalPinOverlay) modalPinOverlay.classList.remove('show');
                if (pendingChannelSelect) {
                    executeChannelSwitch(pendingChannelSelect);
                    pendingChannelSelect = null;
                }
            } else {
                alert("ACCESS DENIED: Incorrect PIN for Channel 10.");
                inputPin.value = '';
            }
        });
    }

    if (btnCancelAction) {
        btnCancelAction.addEventListener('click', () => {
            if (modalChannelActionOverlay) modalChannelActionOverlay.classList.remove('show');
            selectedChannelForAction = null;
        });
    }

    if (btnActionJoin) {
        btnActionJoin.addEventListener('click', () => {
            if (modalChannelActionOverlay) modalChannelActionOverlay.classList.remove('show');
            if (selectedChannelForAction) {
                attemptChannelSwitch(selectedChannelForAction.num);
            }
        });
    }

    if (btnActionInfo) {
        btnActionInfo.addEventListener('click', () => {
            if (modalChannelActionOverlay) modalChannelActionOverlay.classList.remove('show');
            if (selectedChannelForAction) {
                // If checking info for current active channel
                if (selectedChannelForAction.num === activeChannelNum) {
                    if (usersModalCh) usersModalCh.textContent = activeChannelNum;
                    if (modalUsersOverlay) modalUsersOverlay.classList.add('show');
                    updateActiveUsersUI();
                } else {
                    // Check another channel's users by quickly probing without fully switching
                    showForeignChannelUsers(selectedChannelForAction.num);
                }
            }
        });
    }
}

function showForeignChannelUsers(targetChNum) {
    if (usersModalCh) usersModalCh.textContent = targetChNum;
    if (activeUsersList) {
        activeUsersList.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">SCANNING FREQUENCY...</div>';
    }
    if (modalUsersOverlay) modalUsersOverlay.classList.add('show');
    
    // Create a temporary peer to listen for heartbeats briefly
    const tempId = `tactical-comms-scanner-${Math.floor(Math.random()*1000)}`;
    const scanner = new Peer(tempId);
    const foreignUsers = {};
    
    scanner.on('open', () => {
        // Connect to all possible nodes on that channel
        for(let i=1; i<=MAX_NODES; i++) {
            const nodeToScan = `tactical-comms-ch-${targetChNum}-node-${i}`;
            const conn = scanner.connect(nodeToScan);
            
            // If they are there, they will answer our connection and send heartbeats
            conn.on('data', (data) => {
                if (data.type === 'heartbeat') {
                    foreignUsers[i] = {
                        callsign: data.callsign,
                        avatar: data.avatar || '👤',
                        isSpeaking: data.isSpeaking,
                        isMe: false
                    };
                    renderForeignUsers(foreignUsers);
                }
            });
            setTimeout(() => { if(conn) conn.close(); }, 5000); // Close connection after 5s
        }
        
        // Timeout the scan UI after 2.5 seconds
        setTimeout(() => {
            if (Object.keys(foreignUsers).length === 0 && activeUsersList && usersModalCh && usersModalCh.textContent === targetChNum) {
                 activeUsersList.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">NO ACTIVE OPERATORS FOUND</div>';
            }
            scanner.destroy();
        }, 2500);
    });
}

function renderForeignUsers(fUsers) {
    if (!activeUsersList) return;
    activeUsersList.innerHTML = '';
    const usersArr = Object.values(fUsers);
    
    if (usersArr.length === 0) {
        activeUsersList.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">NO ACTIVE OPERATORS FOUND</div>';
        return;
    }
    
    usersArr.forEach(u => {
        const item = document.createElement('div');
        item.className = `user-list-item`;
        item.innerHTML = `
            <div class="user-info-row" style="display: flex; align-items: center; gap: 10px;">
                <div class="user-avatar" style="font-size: 20px;">${u.avatar || '👤'}</div>
                <div class="user-name">${u.callsign}</div>
            </div>
            <div class="user-badges">${u.isSpeaking ? '<span class="badge speaking">TX</span>' : ''}</div>
        `;
        activeUsersList.appendChild(item);
    });
}

// Run
document.addEventListener('DOMContentLoaded', init);
