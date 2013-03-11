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
        
cl.on('error',
      function(e) {
	      logger.error(e);
      });
