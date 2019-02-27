'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var pc;
var remoteStream;
var turnReady;
var sendChannel = null;
var is_chat = false;
document.getElementById('btn_test').disabled = false;

var constraints = {
  "audio": false,
  "video": {
    "mandatory": {
      "minWidth": "600",
      "minHeight": "400"
    },
    "optional": []
  }
};

var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

navigator.mediaDevices.getUserMedia(constraints)
  .then(gotStream)
  .catch(function (e) {
    alert('getUserMedia() error: ' + e.name);
  });

function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = localStream;
  sendMessage('got user media');
}

var pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////

var room = 'foo';
// Could prompt for room name:
room = prompt('Enter room name:');

var socket = io.connect();

if (room !== '') {
  socket.emit('create or join', room);
  console.log('Attempted to create or  join room', room);
}

socket.on('created', function (room) {
  console.log('Created room ' + room);
  isInitiator = true;

});

socket.on('full', function (room) {
  console.log('Room ' + room + ' is full');
});

socket.on('join', function (room) {
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
  //maybeStart();
});

socket.on('joined', function (room) {
  console.log('joined: ' + room);
  isChannelReady = true;
});

socket.on('log', function (array) {
  console.log.apply(console, array);
});


function sendMessage(message) {
  console.log('Client sending message: ', message);
  socket.emit('message', message);
}

// This client receives a message
socket.on('message', function (message) {
  console.log('Client received message:', message);
  if (message === 'got user media') {
    maybeStart();
  } else if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      maybeStart();
    }
    // localVideo.srcObject = localStream;
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    pc.addIceCandidate(candidate);
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});


if (location.hostname !== 'localhost') {
  requestTurn(
    'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
  );
}

function maybeStart() {
  console.log('>>>>>>> maybeStart() ', isStarted, isChannelReady);
  if (!isStarted && isChannelReady) {

    console.log('>>>>>> creating peer connection');
    createPeerConnection();
    pc.addStream(localStream);
    isStarted = true;
    console.log('isInitiator', isInitiator);
    create_data_channel(isInitiator);

  }
}

function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(null);
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function gotReceiveChannel(event) {
  console.log('Receive Channel Callback');
  sendChannel = event.channel;
  sendChannel.onmessage = handleMessage;
  sendChannel.onopen = handleReceiveChannelStateChange;
  sendChannel.onclose = handleReceiveChannelStateChange;
}
function handleMessage(event) {
  if (is_chat) {
    var table = document.getElementById("chat_table");
    var row = table.insertRow(0);
    var cell = row.insertCell(0);
    cell.innerHTML = "Recv: " + event.data;
  }
}
function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  console.log('Send channel state is: ' + readyState);
  enableMessageInterface(readyState == "open");
  clearInterval(testDataChannelInterval);
  testDataChannelInterval = null;
}
function handleReceiveChannelStateChange() {
  var readyState = sendChannel.readyState;
  console.log('Receive channel state is: ' + readyState);
  enableMessageInterface(readyState == "open");
}

window.onbeforeunload = function () {
  console.log('Going to send bye ****');
  alert('before reload');
  sendMessage('bye');
};

function enableMessageInterface(shouldEnable) {
  if (shouldEnable) {
    sendChannel.disabled = false;
    sendChannel.placeholder = "";
    sendChannel.disabled = false;
  } else {
    document.getElementById('btn_send').disabled = true;
    sendChannel.disabled = true;
  }
}

function create_data_channel(is_initiator_dc) {
  if (is_initiator_dc) {
    try {
      // Reliable Data Channels not yet supported in Chrome
      sendChannel = pc.createDataChannel("sendDataChannel", { reliable: true });
      sendChannel.onmessage = handleMessage;
      console.log('Created first send data channel');
      doOffer();
    } catch (e) {
      alert('Failed to create data channel. ' +
        'You need Chrome M25 or later with RtpDataChannel enabled');
      console.error('createDataChannel() failed with exception: ' + e.message);
    }
    sendChannel.onopen = handleSendChannelStateChange;
    sendChannel.onclose = handleSendChannelStateChange;
  } else {
    console.log('Created second send data channel');
    pc.ondatachannel = gotReceiveChannel;
  }

}

function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doOffer() {
  //document.getElementById('btn_test').disabled = false;
  console.log('Sending offer to peer');
  pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
  //document.getElementById('btn_test').disabled = false;
  console.log('Sending answer to peer.');
  pc.createAnswer().then(
    setLocalAndSendMessage,
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
  var turnExists = false;
  for (var i in pcConfig.iceServers) {
    if (pcConfig.iceServers[i].urls.substr(0, 5) === 'turn:') {
      turnExists = true;
      turnReady = true;
      break;
    }
  }
  if (!turnExists) {
    console.log('Getting TURN server from ', turnURL);
    // No TURN server. Get one from computeengineondemand.appspot.com:
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        var turnServer = JSON.parse(xhr.responseText);
        console.log('Got TURN server: ', turnServer);
        pcConfig.iceServers.push({
          'urls': 'turn:' + turnServer.username + '@' + turnServer.turn,
          'credential': turnServer.password
        });
        turnReady = true;
      }
    };
    xhr.open('GET', turnURL, true);
    xhr.send();
  }
}

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added...');

  remoteStream = event.stream;
  remoteVideo.srcObject = remoteStream;
}

function initCanvas(e) {
  console.log('**** init Canvas ****');
}

function drawFrame(e) {
  console.log('**** drawFrame Canvas ****');
}

function onEnd(e) {
  console.log('**** drawFrame Canvas ****');
}


function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  pc.close();
  pc = null;
}

let lastResult;
const textOutput = document.getElementById('textKbps');
window.setInterval(() => {
  if (!pc) {
    return;
  }
  const sender = pc.getSenders()[0];
  if (!sender) {
    return;
  }
  sender.getStats().then(res => {

    res.forEach(report => {
      let bytes;
      if (report.type === 'outbound-rtp') {
        if (report.isRemote) {
          return;
        }
        const now = report.timestamp;

        bytes = report.bytesSent;

        if (lastResult && lastResult.has(report.id)) {
          // calculate bitrate
          const bitrate = 8 * (bytes - lastResult.get(report.id).bytesSent) /
            (now - lastResult.get(report.id).timestamp);
          textOutput.innerHTML = 'Bitrate: ' + bitrate + ' Kbps';
          //console.log(report.mediaType);
        }
      }
    });
    lastResult = res;
  });
}, 1000);


var testDataChannelInterval;
var startTime = 0;
var lastSpeedTest = 0
function TestSpeed() {
  console.log("starting TestSpeed")
  var elem = document.getElementById("btn_test");
  var last_bandwidth_test = document.getElementById('last_bandwidth_test');
  if (sendChannel.readyState == "closed") {
    console.log("data channel is closed  so reopening")
    isInitiator = true
    create_data_channel(isInitiator);
    setTimeout(TestSpeed, 5);
    return
  }
  last_bandwidth_test.innerHTML = "Last speed test result : " + lastSpeedTest + "Kbps";
  if (elem.value == "Test Throughput") {
    last_bandwidth_test.innerHTML = "Last speed test result : " + lastSpeedTest + "Kbps";
    if (!testDataChannelInterval) {
      elem.value = "Stop Test";
      elem.innerHTML = "Stop Test";
      var msg = "";
      console.log('***** Maximum packet size', pc.sctp.maxMessageSize);
      let size = pc.sctp.maxMessageSize - 30;
      for (var i = 0; i < size; ++i) {
        msg += "A";
      }
      startTime = new Date().getTime();
      //console.log(msg);
      TestThroughput(sendChannel, msg);
    } else {
      clearInterval(testDataChannelInterval);
      testDataChannelInterval = null;
    }
  } else {
    last_bandwidth_test.innerHTML = "Last speed test result : " + lastSpeedTest + "Kbps";
    lbl_bandwidth.innerHTML = "";
    elem.value = "Test Throughput";
    elem.innerHTML = "Test Throughput";
    clearInterval(testDataChannelInterval);
    testDataChannelInterval = null;
    console.log("ending TestSpeed")
  }
}

function TestThroughput(channel, msg) {
  if (channel) {
    var amountSent = 0;
    var rate = 0;
    var index = 0;

    testDataChannelInterval = setInterval(
      function () {
        if (sendChannel.readyState != "open") {
          console.log("data channel is not found in opened state")
          var elem = document.getElementById("btn_test");
          var last_bandwidth_test = document.getElementById('last_bandwidth_test');
          last_bandwidth_test.innerHTML = "Last speed test result : " + lastSpeedTest + "Kbps";
          lbl_bandwidth.innerHTML = "";
          elem.value = "Test Throughput";
          elem.innerHTML = "Test Throughput";
          clearInterval(testDataChannelInterval);
          testDataChannelInterval = null;
          console.log("ending TestSpeed")
          setTimeout(TestSpeed, 5);
          return
        }
        var tmp = index + ": " + msg;
        index++;

        channel.send(tmp);
        amountSent += tmp.length;

        if (index % 100 == 0) {
          var currentTime = new Date().getTime();
          rate = 8 * amountSent / (currentTime - startTime);
          lbl_bandwidth.innerHTML = rate + "Kbps";
          lastSpeedTest = rate
        }
      }, 2);
  }
}