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
  roomNick: process.env.ROOM_NICK
}

logger.info("started: " + JSON.stringify(conf));

var cl = new xmpp.Client({ jid: conf.jid,
                           password: conf.password });
                           
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
        
        
        logger.info(stanza);
	    });

cl.on('error',
      function(e) {
	      logger.error(e);
      });
