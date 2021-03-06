var _ = require('underscore')._,
    xmpp = require('node-xmpp'),
    winston = require('winston')

var argv = process.argv;

var logger= new (winston.Logger)({
    transports: [
        new (winston.transports.File)({
            filename:'bot.log',
            timestamp:true,
            json:false,
            level: "debug"
            }),
        new (winston.transports.Console)({
            timestamp:true,
            json:false,
            level: "debug"
            })
    ],
    levels: winston.config.syslog.levels
});

var conf = {
  jid: process.env.JID,
  password: process.env.XMPP_PASSWORD,
  roomJids: JSON.parse(process.env.ROOM_JIDS),
  roomDomain: process.env.ROOM_DOMAIN,
  roomNick: process.env.ROOM_NICK,
}

logger.info("started: " + JSON.stringify(conf));

var cl = new xmpp.Client({ jid: conf.jid,
                           password: conf.password });


// roomRosters is a map where the keys are
// roomJids, and the values are a map where
// its user jids -> role.
var roomRosters = {};
var roomVideoStatus = {};

_.each(conf.roomJids, function(roomName) {
  roomRosters[roomName + "@" + conf.roomDomain] = {};
  roomVideoStatus[roomName + "@" + conf.roomDomain] = {started:false, elapsed:0, startedAt:0};
});

var catchupInterval = setInterval(sendCatchupUpdate, 10000);

cl.on('online', 
        function() {
          logger.info("connected to " + conf.jid);
          
          // keepalive
          setInterval(function() {
              cl.send(' ');
          }, 30000);
          
          // connect to all the rooms specified
          _.each(conf.roomJids, function(roomName) {
            var roomJid = roomName + "@" + conf.roomDomain;

            cl.send(function() {
                el = new xmpp.Element('presence', { to: roomJid+'/'+conf.roomNick });
                x = el.c('x', { xmlns: 'http://jabber.org/protocol/muc' });
                x.c('history', { maxstanzas: 0, seconds: 1});
                return x;
              }());
            
            logger.info("sent request to join room: " + roomJid);
          });
        });
cl.on('stanza',
      function(stanza) {
        
        // toss any message from the bot.
        var fromPieces = stanza.attrs.from.split("/");
        var fromNick;
        
        var fromRoom = fromPieces[0];
        var fromRoomShort = fromRoom.split("@")[0];

        var vidStatus = roomVideoStatus[fromRoom];
        
        if(fromPieces.length==1) {
          // it's a subject message that comes direct from the room.
          // nothing to do with it yet.
          logger.info("room subject: " + stanza.getChild('subject'));
          return;
        } else if(fromPieces.length==2){
          fromNick = fromPieces[1];
          
          if(fromNick==conf.roomNick) {
            // logger.info("throwing out message from ourselves");
            return;
          }
        }
        
        if(stanza.is('presence')) {
          // handle presence stanzas.
          // presence stanzas are either signifying joining or leaving.
          
          if(stanza.attrs.type=="unavailable") {
            // handle a leave message. 
            // logger.info(stanza.attrs.from + " left room.");
            delete roomRosters[fromRoom][fromNick];
          } else {
            // logger.info(stanza.attrs.from + " joined room.");

            _.each(stanza.children, function(child) {
              if(child.attrs.xmlns=="http://jabber.org/protocol/muc#user") {
                var role = child.children[0].attrs.role;
                
                // we're guaranteed for this to only happen once per user.
                roomRosters[fromRoom][fromNick] = role;
              }
            });
            
            if(vidStatus.started || vidStatus.elapsed !=0) {
              
              // the timeout here is to wait for the client to get fully
              // connected. it's perhaps a bit more precise to fix this 
              // in the client, but for now we'll just wait a second before
              // we send the catchup message.
              setTimeout(function() {
                sendCatchupUpdate(fromRoom, stanza.attrs.from);
              }, 1000);
            }
          }
          
        } else if(stanza.is('message')) {
          var isMod = roomRosters[fromRoom][fromNick]=="moderator";
          var message = stanza.getChild('body').getText();
          
          // toss non mod messages
          if(!isMod) {
            return;
          }
          
          logger.debug("status on mod message: " + JSON.stringify(vidStatus));
          if(message.indexOf("/video start")==0) {
            // don't do anything if the video is already going
            if(vidStatus.started) return;
            
            vidStatus.started = true;
            vidStatus.startedAt = Date.now();
            logger.info(fromRoom + " video started");
            logger.info("["+fromRoomShort+"] started");
          } else if(message.indexOf("/video stop")==0) {
            vidStatus.started = false;
            vidStatus.elapsed = (Date.now() - vidStatus.startedAt) + vidStatus.elapsed;
            vidStatus.startedAt = 0;
            
            logger.info("["+fromRoomShort+"] stopped at " + Math.round(vidStatus.elapsed/1000));
          } else if(message.indexOf("/video status")==0) {
            var curTime = vidStatus.elapsed;
            
            if(vidStatus.started) {
              curTime += (Date.now() - vidStatus.startedAt);
            }
            
            logger.info("["+fromRoomShort+"] video at " + Math.round(curTime/1000) + " (" + (vidStatus.started ? "started" : "stopped") + ")");
          } else if(message.indexOf("/video time")==0) {
            // handle time messages. if we set it to a specific time, 
            // set to playing, and set elapsed time to that time.
            
            var commandPieces = message.split(" ");
            
            var seconds = getSecondsFromTime(commandPieces[2]);
            
            var start = true;
            if(commandPieces.length==4) {
              if(commandPieces[3]=="stop") {
                start = false;
              }
            }
            
            vidStatus.started = start;
            vidStatus.elapsed = seconds*1000;
            
            if(start) {
              vidStatus.startedAt = Date.now();
            } else {
              vidStatus.startedAt = 0;
            }
            
            logger.info("["+fromRoomShort+"] set time to " + seconds + " ("+(vidStatus.started ? "started" : "stopped")+")");
          } else if(message.indexOf("/video done")==0) {
            // basically clear the state on this room's video, which should
            // desynchronize clients. on the client side, this will turn
            // the video back into an unloaded state. on the server, we
            // wipe video state.
            
            roomVideoStatus[fromRoom] = {started:false, elapsed:0, startedAt:0};
            
            logger.info("["+fromRoomShort+"] ----- video done -----");
          }
        }
	    });

cl.on('error',
      function(e) {
	      logger.error(e);
      });

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
  console.trace();
});

      
function getSecondsFromTime(timeStr) {
  var timePieces = timeStr.split(":");

  var seconds = 0;

  var counter = 0;
  for(var i=timePieces.length-1; i>=0; i--) {
    var field = parseInt(timePieces[i]);
    switch(counter) {
      case 0:
        seconds += field;
        break;
      case 1:
        seconds += 60*field;
        break;
      case 2:
        seconds += 60*60*field;
        break;
    }
    counter++;
  }

  return seconds;
}


function sendCatchupUpdate(fromRoom, forUser) {
  // loop through all our rooms. for rooms that are currently started,
  // send a catchup message
  
  // TODO do some cleverness to check if fromRoom is set. If it is, do this
  // once. If it's not, loop through all known rooms and check if we should
  // update.
  
  var rooms;
  if(fromRoom!==undefined) {
    rooms = [fromRoom];
  } else {
    rooms = Object.keys(roomRosters);
  }
  
  _.each(rooms, function(room) {
    var roomShort = room.split("@")[0];
    var vidStatus = roomVideoStatus[room];
    
    if(!vidStatus.started && vidStatus.elapsed==0) {
      // drop out if the video in this room isn't running and has no elapsed
      // time.
      logger.debug("Ignoring room update that has no vid running: " + JSON.stringify(vidStatus) + "; room: " + roomShort);
      return;
    }
    
    cl.send(function() {
      el = new xmpp.Element('message', {
        to: room,
        type: "groupchat",
      });

      var time = vidStatus.elapsed;

      if(vidStatus.started) {
        time += (Date.now() - vidStatus.startedAt);
      }

      var msg = "/video catchup " + Math.round(time/1000);

      if(!vidStatus.started) {
       msg += " stop";
      }

      if(forUser!==undefined) {
        logger.info("["+roomShort+"] sent catchup: " + Math.round(time/1000) + " (in response to "+forUser+" joining)");
      } else {
        logger.info("["+roomShort+"] sent catchup: " + Math.round(time/1000) + " (periodic)");
      }

      return el.c('body').t(msg);
    }());
  });
}