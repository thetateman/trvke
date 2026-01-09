"use strict";

import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import http from "http";
import express from "express";
import { config } from "dotenv";
import { WebSocketServer } from "ws";
config();

const appId = process.env.APPID;
const appSecret = process.env.APPSECRET;

if(!appId || !appSecret){
    console.error("To run this server you must add a .env file in the server directory. It should contain variables APPID and APPSECRET, which you can obtain by creating a Realtime App in the Cloudflare dashboard.")
}


const app = express();

// Security middleware
app.set('trust proxy', 'loopback');

app.use(express.json());
app.use(express.urlencoded({extended: true}));

const allTracks = {};

// This is a class the defines the Realtime API interactions.
// It's not an SDK but a example of how Realtime API can be used.
class RealtimeApp {
    constructor(appId, basePath = 'https://rtc.live.cloudflare.com/v1') {
        this.prefixPath = `${basePath}/apps/${appId}`;
    }


    async sendRequest(url, body, method = 'POST') {
        const request = {
        method: method,
        mode: 'cors',
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${appSecret}`
        },
        body: JSON.stringify(body)
        };
        const response = await fetch(url, request);
        const result = await response.json();
        return result;
    }


    checkErrors(result, tracksCount = 0) {
        if (result.errorCode) {
        throw new Error(result.errorDescription);
        }
        for (let i = 0; i < tracksCount; i++) {
        if (result.tracks[i].errorCode) {
            throw new Error(
            `tracks[${i}]: ${result.tracks[i].errorDescription}`
            );
        }
        }
    }


    // newSession sends the initial offer and creates a session
    async newSession(offerSDP) {
        const url = `${this.prefixPath}/sessions/new`;
        const body = {
        sessionDescription: {
            type: 'offer',
            sdp: offerSDP
        }
        };
        const result = await this.sendRequest(url, body);
        this.checkErrors(result);
        this.sessionId = result.sessionId;
        return result;
    }


    // newTracks shares local tracks or gets tracks
    async newTracks(trackObjects, sessionId, offerSDP = null) {
        const url = `${this.prefixPath}/sessions/${this.sessionId}/tracks/new`;
        const body = {
        sessionDescription: {
            type: 'offer',
            sdp: offerSDP
        },
        tracks: trackObjects
        };
        if (!offerSDP) {
        delete body['sessionDescription'];
        }
        const result = await this.sendRequest(url, body);
        this.checkErrors(result, trackObjects.length);
        if(trackObjects[0].location == 'local'){ // these are tracks being published.
            result.tracks.forEach((track)=>{
                allTracks[track.trackName] = {location: "remote", sessionId: sessionId, trackName: track.trackName}
            })
        }
        
        return result;
    }


    // sendAnswerSDP sends an answer SDP if a renegotiation is required
    async sendAnswerSDP(answer) {
        const url = `${this.prefixPath}/sessions/${this.sessionId}/renegotiate`;
        const body = {
        sessionDescription: {
            type: 'answer',
            sdp: answer
        }
        };
        const result = await this.sendRequest(url, body, 'PUT');
        this.checkErrors(result);
    }
}

// Create a instance of RealtimeApp (defined above). Please note that this is not an official SDK but just a demo showing the HTML API.
let rtApp = new RealtimeApp(appId);

app.use("/api/newSession", async (req, res)=>{
    //req body should contain our client's sdp
    let body = req.body
    const newSessionResult = await rtApp.newSession(
      body.sdp
    );
    req.responseObj = {newSessionResult}
    res.json(req.responseObj);
});
app.use("/api/newTracks", async (req, res)=>{
    let body = req.body
    const newLocalTracksResult = await rtApp.newTracks(
      body.trackObjects,
      body.sessionId,
      body.sdp
    );
    req.responseObj = {newLocalTracksResult}
    res.json(req.responseObj);
});
app.use("/api/sendAnswerSDP", async (req, res)=>{
    let body = req.body
    const newLocalTracksResult = await rtApp.sendAnswerSDP(
      body.answer
    );
    req.responseObj = {sucess: true}
    res.json(req.responseObj);
});













//app.use("/api", apiRouter);
app.get("/robots.txt", (req, res) => {
    res.sendFile(path.resolve(`${__dirname}/../robots.txt`));
});

async function asyncWalletGenerator(req, res, next){
  console.log("Generating wallet...");
  next();
}
app.use("/api/create-wallet", asyncWalletGenerator, (req, res)=>{
  res.json(req.responseObj);
});

/*
function authLogic(req, res, next) {
    //console.log(req.ip);
    //TODO: fix below
    if(req.session.isAuth || req.originalUrl.includes('login') || req.originalUrl === '/img/a_background.webm'|| req.originalUrl === '/img/a_background.mp4'){
         next();
    } else {
        req.session.username = 'Guest' + guestID;
        guestID++;
        req.session.isAuth = true;
        //res.status(401);
        //res.redirect('/login');
        next();
    }
}


app.use(authLogic);
*/

app.use(express.static(path.resolve(`${__dirname}/../client`), {index: 'cf-test.html'}));

/*

app.use('/login', (req, res) => {
    res.sendFile(path.resolve(`${__dirname}/../client/login.html`));
});
app.use('/lobby', (req, res) => {
    res.sendFile(path.resolve(`${__dirname}/../client/lobby.html`));
});
app.use('/about', (req, res) => {
    res.sendFile(path.resolve(`${__dirname}/../client/about.html`));
});
app.use('/game', (req, res) => {
    let requestedGameID = req.query.gameid;
    res.sendFile(path.resolve(`${__dirname}/../client/index.html`));
});
*/

const server = http.createServer(app);
let wss = new WebSocketServer({server});

wss.on('connection', function connection(ws, req){
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`${ip} connected.`)
  ws.on('error', (e)=>{
    console.error(e);
  });
  ws.on('close', function close(message){
    console.log(`${ip} disconnected`)
  })
  ws.on('message', function message(data, isBinary){
    const message = isBinary ? data : data.toString();

    let messageObj;
    try{
      messageObj = JSON.parse(message);
      if(!messageObj?.method){
        throw new Error("Invalid message");
      }

    } catch(e){
      ws.send(JSON.stringify({errors:"Invalid message. Failed to subscribe."}));
      return;
    }
    console.log(messageObj);
    if(messageObj.method === 'getTracks'){
      ws.send(JSON.stringify({method: 'getTracks', allTracks}))
    } else if(messageObj.method === 'newTracksAdded'){
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({method: "newTracksAdded", allTracks: messageObj.tracksAdded}));
            }
        });
    } 
  })
});


server.on('error', (err) => {
    console.error(err);
});

server.listen(8080, () => {
    console.log('server started, view your webpage at http://localhost:8080');
});