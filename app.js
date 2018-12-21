/* jshint esnext: true */
require('events').EventEmitter.prototype._maxListeners = 0;
var config = require('/Users/nikolajuskarpovas/Desktop/AWS/chatster_microservices/api-group-chat-q/config/config.js');
var functions = require('/Users/nikolajuskarpovas/Desktop/AWS/chatster_microservices/api-group-chat-q/lib/func_lib.js');
var email = require('/Users/nikolajuskarpovas/Desktop/AWS/chatster_microservices/api-group-chat-q/lib/email_lib.js');
var fs = require("fs");
var express = require("express");
var https = require('https');
var options = {
    key: fs.readFileSync(config.security.key),
    cert: fs.readFileSync(config.security.cert)
};
var app = express();
var bodyParser = require("body-parser");
var cors = require("cors");
var amqp = require('amqplib/callback_api');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static("./public"));
app.use(cors());

app.use(function(req, res, next) {
    next();
});

var server = https.createServer(options, app).listen(config.port.group_chat_q_port, function() {
    email.sendNewApiGroupChatQIsUpEmail();
});

var io = require("socket.io")(server, { transports: ['websocket'] });


/**
 *   RabbitMQ connection object
 */
var amqpConn = null;


/**
 *  Subscribe user on topic to receive messages
 */
function subscribeToTopic(topic) {
    if (amqpConn !== null) {
        amqpConn.createChannel(function(err, ch) {
            var exchange = 'apiGroupChatQ.*';
            var toipcName = `apiGroupChatQ.${topic}`;
            
            ch.assertExchange(exchange, 'topic', { durable: true });
            ch.assertQueue(toipcName, { exclusive: false, auto_delete: true }, function(err, q) {
                ch.bindQueue(q.queue, exchange, toipcName);
                ch.consume(q.queue, function(msg) {
                    var message = JSON.parse(msg.content.toString());
                    if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.groupOfflineMessage}`){
                        console.log("groupOfflineMessage");
                        functions.saveGroupChatOfflineMessage(message, amqpConn, config.rabbitmq.topics.groupOfflineMessageQ);
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.receivedGroupOnlineMessage}`){
                        functions.saveGroupOnlineMessages(message, amqpConn, config.rabbitmq.topics.receivedGroupOnlineMessageQ);
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.deleteGroupReceivedOnlineMessage}`){
                        functions.deleteReceivedOnlineGroupMessages(message, amqpConn, config.rabbitmq.topics.deleteGroupReceivedOnlineMessageQ);
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.updateGroupProfile}`){
                        functions.updateGroupPicAndStatus(message.groupId, message.statusMessage, message.profilePicUrl, amqpConn, config.rabbitmq.topics.updateGroupProfile);
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.userLeftGroup}`){
                        functions.exitGroupChat(message, amqpConn, config.rabbitmq.topics.userLeftGroupQ);
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.deleteGroupChatInvitation}`){
                        functions.deleteGroupChatInvitation(message, amqpConn, config.rabbitmq.topics.deleteGroupChatInvitationQ);
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.createGroupChat}`){
                        console.log("topic createGroupChat");
                        functions.createGroupChat(message, amqpConn, config.rabbitmq.topics.createGroupChatQ); 
                    } else if (toipcName === `apiGroupChatQ.${config.rabbitmq.topics.addNewMembersToGroupChat}`){
                        functions.addNewMembersToGroupChat(message, amqpConn, config.rabbitmq.topics.addNewMembersToGroupChatQ);
                    } 
                }, { noAck: true });
            });
        });
    }
}

/**
 *  Connect to RabbitMQ
 */
function connectToRabbitMQ() {
    amqp.connect(config.rabbitmq.url, function(err, conn) {
        if (err) {
            console.error("[AMQP]", err.message);
            return setTimeout(connectToRabbitMQ, 1000);
        }
        conn.on("error", function(err) {
            if (err.message !== "Connection closing") {
                console.error("[AMQP] conn error", err.message);
            }
        });
        conn.on("close", function() {
            console.error("[AMQP] reconnecting");
            return setTimeout(connectToRabbitMQ, 1000);
        });
        console.log("[AMQP] connected");
        amqpConn = conn;

        subscribeToTopic(config.rabbitmq.topics.groupOfflineMessage);
        subscribeToTopic(config.rabbitmq.topics.deleteGroupOfflineMessage);
        subscribeToTopic(config.rabbitmq.topics.receivedGroupOnlineMessage);
        subscribeToTopic(config.rabbitmq.topics.deleteGroupReceivedOnlineMessage);
        subscribeToTopic(config.rabbitmq.topics.updateGroupProfile);
        subscribeToTopic(config.rabbitmq.topics.userLeftGroup);
        subscribeToTopic(config.rabbitmq.topics.deleteGroupChatInvitation);
        subscribeToTopic(config.rabbitmq.topics.createGroupChat);
        subscribeToTopic(config.rabbitmq.topics.addNewMembersToGroupChat);
        subscribeToTopic(config.rabbitmq.topics.deleteRetrievedGroupChatMessages);
    });
}
connectToRabbitMQ();

/**
 *  POST remove all group chat online/offline messages that were retrieved by the user
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
app.post("/deleteRetrievedGroupMessages", function(req, res) {
    functions.deleteRetrievedGroupMessages(req, res, amqpConn);
});


/**
 *  GET all groupOffline messages for the user with id and all of the users group chat ids
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
app.get("/groupOfflineMessages", function(req, res) {
    functions.groupOfflineMessages(req, res);
});


/**
 *  GET all group chat invitations for the user with id
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
app.get("/groupChatInvitations", function(req, res) {
    functions.groupChatInvitations(req, res);
});
