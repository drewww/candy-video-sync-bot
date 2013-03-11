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
  roomVideoStatus[roomName + "@" + conf.roomDomain] = {started:false, elapsed:0, startedAt:0}
});

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
        
        if(fromPieces.length==1) {
          // it's a subject message that comes direct from the room.
          // nothing to do with it yet.
          logger.info("room subject: " + stanza.getChild('subject').getText());
          return;
        } else if(fromPieces.length==2){
          fromNick = fromPieces[1];
          
          if(fromNick==conf.roomNick) {
            logger.info("throwing out message from ourselves");
            return;
          }
        }
        
        if(stanza.is('presence')) {
          // handle presence stanzas.
          // presence stanzas are either signifying joining or leaving.
          
          if(stanza.attrs.type=="unavailable") {
            // handle a leave message. 
            logger.info(stanza.attrs.from + " left room.");
            delete roomRosters[fromRoom][fromNick];
          } else {
            logger.info(stanza.attrs.from + " joined room.");
            
            logger.info(stanza);
            
            _.each(stanza.children, function(child) {
              if(child.attrs.xmlns=="http://jabber.org/protocol/muc#user") {
                var role = child.children[0].attrs.role;
                
                // we're guaranteed for this to only happen once per user.
                roomRosters[fromRoom][fromNick] = role;
              }
            });
          }
          
        } else if(stanza.is('message')) {
          var isMod = roomRosters[fromRoom][fromNick]=="moderator";
          var message = stanza.getChild('body').getText();
          
          // toss non mod messages
          if(!isMod) {
            return;
          }
          
          var vidStatus = roomVideoStatus[fromRoom];
          logger.info("status: " + JSON.stringify(vidStatus));
          if(message.indexOf("/video start")==0) {
            // don't do anything if the video is already going
            if(vidStatus.started) return;
            
            vidStatus.started = true;
            vidStatus.startedAt = Date.now();
            logger.info(fromRoom + " video started");
          } else if(message.indexOf("/video stop")==0) {
            vidStatus.started = false;
            vidStatus.elapsed = (Date.now() - vidStatus.startedAt) + vidStatus.elapsed;
            logger.info(fromRoom + " video paused");
          } else if(message.indexOf("/video status")==0) {
            var curTime = vidStatus.elapsed;
            
            if(vidStatus.started) {
              curTime += (Date.now() - vidStatus.startedAt);
            }
            
            logger.info(fromRoom + ": " + Math.round(curTime/1000));
          } else if(message.indexOf("/video time")==0) {
            // handle time messages. if we set it to a specific time, 
            // set to playing, and set elapsed time to that time.
            
            var commandPieces = message.split(" ");
            
            var seconds = getSecondsFromTime(commandPieces[2]);
            
            vidStatus.started = true;
            vidStatus.elapsed = seconds*1000;
            vidStatus.startedAt = Date.now();
          }
        }
        
        
        // steps to bot bliss:
        // we need to keep our own track of users in each room
        // when we log in, we get a bunch of presence messages. we need to 
        // cache those, because they contain the role data for users
        // which we need to decide which users' messages to respond to
        
        // 1. watch for presence messages. cache those in a room-specific roster, along with their role information.
        // 2. after the initial flurry, treat new presence messages as users joining - send them the current video time, with /video catchup mm:ss
        //      this is important in case the bot crashes; we don't want it
        //      to send a huge flurry of messages out to everyone. 
        // 3. watch for chat messages. if not from a moderator, ignore
        //      if from a moderator, look for /video start and /video stop
        //      and /video time. Build a model to keep track of 
        
        
        // logger.info(stanza);
	    });

cl.on('error',
      function(e) {
	      logger.error(e);
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
