/*
  Copyright (C) 2017 - 2020 MWSOFT

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
/* jshint esnext: true */
var fs = require('fs');
var path = require('path');
var config = require('/Users/nikolajuskarpovas/Desktop/AWS/chatster_microservices/api-group-chat-q/config/config.js');
var email = require('/Users/nikolajuskarpovas/Desktop/AWS/chatster_microservices/api-group-chat-q/lib/email_lib.js');
var time = require('/Users/nikolajuskarpovas/Desktop/AWS/chatster_microservices/api-group-chat-q/lib/time_lib.js');
var aws = require("aws-sdk");
var s3 = new aws.S3();
var rn = require('random-number');
var gen = rn.generator({
    min: 1000,
    max: 9999,
    integer: true
});
var contentType = require('content-type');
var fileType = require('file-type');
var multer = require('multer');
const uploadGroupImageMessage = multer({
    dest: 'imagesGroup/',
    limits: { fileSize: 10000000, files: 1 },
    fileFilter: (req, file, callback) => {
        if (!file.originalname.match(/\.(jpg|jpeg)$/)) {
            return callback(new Error('Only Images are allowed !'), false)
        }
        callback(null, true);
    }
}).single('image');


/**
 *  Setup the pool of connections to the db so that every connection can be reused upon it's release
 *
 */
var mysql = require('mysql');
var Sequelize = require('sequelize');
const sequelize = new Sequelize(config.db.name, config.db.user_name, config.db.password, {
    host: config.db.host,
    dialect: config.db.dialect,
    port: config.db.port,
    operatorsAliases: config.db.operatorsAliases,
    pool: {
      max: config.db.pool.max,
      min: config.db.pool.min,
      acquire: config.db.pool.acquire,
      idle: config.db.pool.idle
    }
});

/**
 * Model of group_chat_offline_message table
 * 
 */
const ReceivedOnlineGroupChatMessage = sequelize.define('received_online_group_chat_message', {
    msg_type: {type: Sequelize.STRING, allowNull: false},
    content_type: {type: Sequelize.STRING, allowNull: false},
    sender_id: { 
        type: Sequelize.INTEGER,
        allowNull: false
    },
    receiver_id: { type: Sequelize.INTEGER, allowNull: false },
    group_chat_id: { 
        type: Sequelize.STRING,
        allowNull: false
    },
    message: {type: Sequelize.STRING, allowNull: false},
    message_uuid: {type: Sequelize.STRING, allowNull: false},
    group_member_one_time_pbk_uuid: {type: Sequelize.STRING, allowNull: false},
    item_created: {type: Sequelize.STRING, allowNull: false}
    }, {
        freezeTableName: true, // Model tableName will be the same as the model name
        timestamps: false,
        underscored: true
    }
);


/**
 * Model of group_chat_offline_message table
 * 
 */
const GroupChatOfflineMessage = sequelize.define('group_chat_offline_message', {
    msg_type: {type: Sequelize.STRING, allowNull: false},
    content_type: {type: Sequelize.STRING, allowNull: false},
    sender_id: { 
        type: Sequelize.INTEGER,
        allowNull: false
    },
    receiver_id: { type: Sequelize.INTEGER, allowNull: false },
    group_chat_id: { 
        type: Sequelize.STRING,
        allowNull: false
    },
    message: {type: Sequelize.STRING, allowNull: false},
    message_uuid: {type: Sequelize.STRING, allowNull: false},
    group_member_one_time_pbk_uuid: {type: Sequelize.STRING, allowNull: false},
    item_created: {type: Sequelize.STRING, allowNull: false}
    }, {
        freezeTableName: true, // Model tableName will be the same as the model name
        timestamps: false,
        underscored: true
    }
);

/**
 *  Publishes message to api-group-chat-c on specified topic
 */
module.exports.publishToGroupChatC = function(amqpConn, message, topic) {
    if (amqpConn !== null) {
        amqpConn.createChannel(function(err, ch) {
            var exchange = 'apiGroupChatC.*';
            var key = `apiGroupChatC.${topic}`;
            ch.assertExchange(exchange, 'topic', { durable: true });
            ch.publish(exchange, key, new Buffer(message));
        });
    }
}

/**
 *  Updates group profile pic and status message
 *
 * (groupId String): id of the group of which profile picture and status are to be updated
 * (statusMessage String): status message
 * (profilePicUrl String): URL to profile picture
 * (amqpConn Object): RabbitMQ connection object that is used to send api-group-chat-c response
 */
module.exports.updateGroupPicAndStatus = function(groupId, statusMessage, profilePicUrl, amqpConn, topic){
    // update groupChatImage and groupChatStatusMessage for group with id
    sequelize.query('CALL UpdateGroupStatusAndProfilePicture(?,?,?)',
    { replacements: [ groupId, statusMessage, profilePicUrl ],
         type: sequelize.QueryTypes.RAW }).then(result => {
            // publish verification of update group on api-group-chat-c
            var response = {
                status: config.rabbitmq.statuses.ok
            };
            module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        // publish verification of update group on api-group-chat-c
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
}

/**
 *  Removes user from this group
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.exitGroupChat = function (message, amqpConn, topic){
    sequelize.query('CALL ExitGroupChat(?,?)',
    { replacements: [ message.groupChatId, message.userId ],
         type: sequelize.QueryTypes.RAW }).then(result => {
            // publish verification user left group on api-group-chat-c
            var response = {
                status: config.rabbitmq.statuses.ok
            };
            module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        // publish verification user left group on api-group-chat-c
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};


/**
 *  Deletes group chat invitation
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.deleteGroupChatInvitation = function (message, amqpConn, topic){
    sequelize.query('CALL DeleteGroupChatInvitation(?,?)',
    { replacements: [ message.userId, message.groupChatId ],
         type: sequelize.QueryTypes.RAW }).then(result => {
            // publish verification delete group chat invitation on api-group-chat-c
            var response = {
                status: config.rabbitmq.statuses.ok
            };
            module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatCErrorEmail(err);
        // publish verification delete group chat invitation on api-group-chat-c
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};


/**
 * Deletes received online group messages
 */
module.exports.deleteReceivedOnlineGroupMessages = function(message, amqpConn, topic){
    sequelize.query('CALL DeleteReceivedOnlineGroupMessage(?,?)',
    { replacements: [ message.uuid, message.receiverId ],
        type: sequelize.QueryTypes.RAW }).then(result => {
            // publish verification delete received online messages on api-group-chat-c
            var response = {
                status: config.rabbitmq.statuses.ok
            };
            module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};

/**
 *  Retrieves the latest contacts information
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.createGroupChat = function (groupChat, amqpConn, topic) {
    var myutc = time.getCurrentUTC();
    sequelize.query('CALL SaveNewGroupChat(?,?,?,?,?,?,?)',
    { replacements: [ groupChat._id, groupChat.groupChatAdminId, groupChat.groupChatName, groupChat.groupChatStatusMessage, groupChat.groupChatImage, myutc, groupChat.groupChatMembers.toString() ],
         type: sequelize.QueryTypes.RAW }).then(result => {
            // publish verification create new group chat on api-group-chat-q
            var response = {
                status: config.rabbitmq.statuses.ok
            };
            module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};


/**
 *  Adds new member to an existing group chat
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.addNewMembersToGroupChat = function (message, amqpConn, topic) {
    var myutc = time.getCurrentUTC();
    sequelize.query('CALL AddNewGroupChatMembers(?,?,?,?)',
    { replacements: [ message.groupChatId, message.newGroupChatMembers.toString(), message.groupChatAdmin, myutc  ],
         type: sequelize.QueryTypes.RAW }).then(result => {
            // publish verifictaion add new group chat members on api-group-chat-c
            var response = {
                status: config.rabbitmq.statuses.ok
            };
            module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};


/**
 *  Saves offline group chat messages
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.saveGroupChatOfflineMessage = function (offlineGroupChatMembersMessages, amqpConn, topic){
    console.log(JSON.stringify(offlineGroupChatMembersMessages));
    GroupChatOfflineMessage.bulkCreate(offlineGroupChatMembersMessages, { fields: ['msg_type', 'content_type', 'sender_id', 'receiver_id', 'group_chat_id', 'message', 'message_uuid', 'group_member_one_time_pbk_uuid', 'item_created'] }).then(() => {
        // publish verification save new offline message on api-group-chat-c
        var response = {
            status: config.rabbitmq.statuses.ok
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};


/**
 * Saves received online group messages until receiver acknowledges receiving them, then all these messages will be deleted
 * 
 */
module.exports.saveGroupOnlineMessages = function (messages, amqpConn, topic){
    ReceivedOnlineGroupChatMessage.bulkCreate(messages, { fields: ['msg_type', 'content_type', 'sender_id', 'receiver_id', 'group_chat_id', 'message', 'message_uuid', 'group_member_one_time_pbk_uuid', 'item_created'] }).then(() => {
        // publish verification save new online message on api-group-chat-c
        var response = {
            status: config.rabbitmq.statuses.ok
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        var response = {
            status: config.rabbitmq.statuses.error
        };
        module.exports.publishToGroupChatC(amqpConn, JSON.stringify(response), topic);
    });
};


/**
 *  Sends notification error message
 * (newOnlineReceivedMessages array): response array that is used to send user error response
 * (res Object): response object that is used to send user response
 */
function sendNotificationsErrorMessage(newOnlineReceivedMessages, res) {
  var receivedOnlineErrorMessage = {
      returnType: "error",
      msgType: "groupChatMsg",
      contentType: "error",
      senderId: 0,
      senderName: "error",
      groupChatId: "error",
      messageText: "error",
      uuid: "error",
      messageCreated: "error"
  };
  newOnlineReceivedMessages.push(receivedOnlineErrorMessage);
  res.json(newOnlineReceivedMessage);
}


/**
 *  Deletes retrieved group messages and checks if there are new messages availble
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.deleteRetrievedGroupMessages = function (req, res, amqpConn){
    var newOnlineReceivedMessages = [];
    if (req.query.uuids !== undefined && req.query.uuids !== null && req.query.dstId !== undefined && req.query.dstId !== null) {
        sequelize.query('CALL ProcessReceivedGroupOnlineMessages(?,?)',
        { replacements: [ req.query.dstId, req.query.uuids.toString() ],
            type: sequelize.QueryTypes.RAW }).then(result => {
                if(result.length > 0){
                    for (var j = 0; j < result.length; j++) {
                        var receivedOnlineGroupMessage = {
                            returnType: "success",
                            msgType: "groupChatMsg",
                            contentType: result[j].content_type,
                            senderId: result[j].sender_id,
                            groupChatId: result[j].group_chat_id,
                            messageText: result[j].message,
                            uuid: result[j].message_uuid,
                            contactPublicKeyUUID: result[j].group_member_one_time_pbk_uuid,
                            messageCreated: result[j].item_created
                        };
                        newOnlineReceivedMessages.push(receivedOnlineGroupMessage);
                    }
                }
                
                var message = {
                    uuids: req.query.uuids.toString(),
                    receiverId: req.query.dstId
                };
                module.exports.publishToGroupChatC(amqpConn, JSON.stringify(message),config.rabbitmq.topics.deleteRetrievedGroupChatMessagesQ);
    
                res.json(newOnlineReceivedMessages);
        }).error(function(err){
            email.sendApiGroupChatQErrorEmail(err);
            sendNotificationsErrorMessage(newOnlineReceivedMessages, res);
        });
    } else {
        res.json(newOnlineReceivedMessages);
    }
};


  /**
 *  Retrieves offline group chat messages
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.groupOfflineMessages = function (req, res){
    var offlineMsgs = [];
    sequelize.query('CALL GetOfflineGroupMessages(?)',
    { replacements: [ req.query.dstId ],
        type: sequelize.QueryTypes.RAW }).then(result => {
            for (var i = 0; i < result.length; i++) {
                var groupChatOfflineMessage = {
                    msgType: result[i].msg_type,
                    contentType: result[i].content_type,
                    groupChatId: result[i].group_chat_id,
                    senderId: result[i].sender_id,
                    messageText: result[i].message,
                    uuid: result[i].message_uuid,
                    contactPublicKeyUUID: result[i].group_member_one_time_pbk_uuid,
                    messageCreated: result[i].item_created
                };
                offlineMsgs.push(groupChatOfflineMessage);
            }
            res.json(offlineMsgs);
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        res.json(offlineMsgs);
    });
  };
  
/**
 *  Retrieves  group chat invitations
 *
 * (req Object): object that holds all the request information
 * (res Object): object that is used to send user response
 */
module.exports.groupChatInvitations = function (req, res){
    var GroupChatInvitations = [];
    sequelize.query('CALL GetGroupChatInvitation(?)',
    { replacements: [ req.query.dstId ],
        type: sequelize.QueryTypes.RAW }).then(result => {
            var groupChatInvitation = {
                msgType: "groupChatInvitation",
                groupChatInvitationChatId: result[0].group_chat_id,
                groupChatInvitationChatName: result[0].group_chat_name,
                groupProfilePicPath: result[0].group_chat_image,
                groupChatInvitationSenderId: result[0].group_chat_invitation_sender_id,
                groupChatInvitationGroupChatMembers: []
            };
            sequelize.query('CALL GetGroupChatMembers(?)',
            { replacements: [ groupChatInvitation.groupChatInvitationChatId ],
                type: sequelize.QueryTypes.RAW }).then(result => {
                    console.log(result);
                    for(var m = 0; m < result.length; m++){
                        groupChatInvitation.groupChatInvitationGroupChatMembers.push(result[m].group_chat_invitee_id);
                    }
                    GroupChatInvitations.push(groupChatInvitation);
                    res.json(GroupChatInvitations);
            }).error(function(err){
                email.sendApiGroupChatQErrorEmail(err);
                res.json(GroupChatInvitations);
            });
    }).error(function(err){
        email.sendApiGroupChatQErrorEmail(err);
        res.json(GroupChatInvitations);
    });
};