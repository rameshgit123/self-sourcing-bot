/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');
var app = express();

var sdk = require('facebook-node-sdk');
var fb = new sdk({
    appId: config.get('AppId'),
    secret: config.get('appSecret')
}).setAccessToken(config.get('pageAccessToken'));

app.set('port', process.env.PORT || 5000);
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN)) {
    console.error("Missing config values");
    process.exit(1);
}




//for send messages to users
app.get('/sendmessage', function (req, res) {
    res.send('Facebook Messanger Bot...!');
    if (req.query['senderid'] != null) {
        sendTextMessage(req.query['senderid'], "Good Morning!!!");
        var messageData = {
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": [{
                        "title": "Do you have any visicooler/fridge/chiller like above?",
                        "subtitle": "",
                        "image_url": "https://self-sourcing-bot.herokuapp.com/refridge.jpg",
                        "buttons": [{
                            "type": "postback",
                            "title": "Yes",
                            "payload": "Q1YES"
                        }, {
                            "type": "postback",
                            "title": "No",
                            "payload": "Q1NO"
                        }]
                    }]
                }
            }
        };
        setTimeout(function () {
            sendGenericMessage(req.query['senderid'], messageData);
            writelog(req.query['senderid'], "Do you have any visicooler/fridge/chiller like above?", "BOT");
        }, 300);
    }
});

//send custom messages to users
//for send messages to users
app.get('/sendcustommessage', function (req, res) {  
    if (req.query['senderid'] != null) {
        sendTextMessage(req.query['senderid'], req.query['msg']);
    }
});

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === VALIDATION_TOKEN) {
        console.log("Validating webhook");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);          
    }  
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/implementation#subscribe_app_pages
 *
 */
app.post('/webhook', function (req, res) {

    var data = req.body;

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function(pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function(messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        //
        // You must send back a 200, within 20 seconds, to let us know you've 
        // successfully received the callback. Otherwise, the request will time out.
        res.sendStatus(200);
    }
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        // For testing, let's log an error. In production, you should throw an 
        // error.
        console.error("Couldn't validate the signature.");
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                            .update(buf)
                            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference#auth
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the 
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger' 
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
      "through param '%s' at %d", senderID, recipientID, passThroughParam, 
      timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}


/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#received_message
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    var messageId = message.mid;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;


    if (messageText) {  

        checkstatus(senderID,messageText,"text","","","","");   
        // If we receive a text message, check to see if it matches any special
        // keywords and send back the corresponding example. Otherwise, just echo
        // the text we received.
        //    switch (messageText) {  
        //      case 'receipt':
        //        sendReceiptMessage(senderID);
        //        break;
        //      default:
        //        sendTextMessage(senderID, messageText);
        //    }
    } else if (messageAttachments) {
  
        if(senderID!="401047436899065")
        {
            if(messageAttachments[0].type=="image")
            { 
               // sendTextMessage(senderID, "Message with attachment received");
                checkstatus(senderID, "file", messageAttachments[0].type, messageAttachments, "", "", "");

            }
            else{
                 checkstatus(senderID, "file", messageAttachments[0].type, messageAttachments, "", "", "");
            }
        }
       

    }
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference#message_delivery
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;               

    if (messageIDs) {
        //    messageIDs.forEach(function(messageID) {
        //      console.log("Received delivery confirmation for message ID: %s", 
        //        messageID);

        //           
        //    });
    }

    //console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. Read
 * more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#postback
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback 
    // button for Structured Messages. 
    var payload = event.postback.payload;
    if(payload=="Q1YES")
    {           
      

        fb.api('/' + senderID + '', function (err, data) {            
            if (data) {  
                            
                assignmission(senderID,data.first_name+" "+data.last_name,data.profile_pic,"Q1YES",recipientID); 
            }
        }); 
     
      
    }
    else if(payload=="Q1NO")
    {
        fb.api('/' + senderID + '', function (err, data) {            
            if (data) {          
                assignmission(senderID,data.first_name+" "+data.last_name,data.profile_pic,"Q1NO",recipientID);               
            }
        }); 
    }  
    else if(payload=="USER_DEFINED_PAYLOAD")
    {
      
        var messageData = {
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": [{
                        "title": "Nielsen Privacy and Consent Notice",
                        "subtitle": "",
                        "image_url": "",
                        "buttons": [{
                            "type": "web_url",
                            "url": "https://self-sourcing-bot.herokuapp.com/",
                            "title": "View Nielsen Privacy"                          
                        }, {
                            "type": "postback",
                            "title": "Agree",
                            "payload": "Agree"
                        },
                         {
                             "type": "postback",
                             "title": "Disagree",
                             "payload": "Disagree"
                         }]
                    }]
                }
            }
        };
   
        sendGenericMessage(senderID, messageData);
    
      
     

    
      
    }
    else if(payload=="Agree")
    {    


        var messageData2 = {                  
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": [{
                        "title": "Select Your Language",
                        "subtitle": "",
                        "buttons": [{
                            "type": "postback",
                            "title": "English",
                            "payload": "English"
                        },{
                            "type": "postback",
                            "title": "Telugu",
                            "payload": "Telugu"
                        }]
                    }]
                }
            }                    
        };

        //Bangla
        var messageData1 = {                  
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": [{
                        "title": "Select Your Language",
                        "subtitle": "",
                        "buttons": [{
                            "type": "postback",
                            "title": "Bangla",
                            "payload": "Bangla"
                        },{
                            "type": "postback",
                            "title": "Marathi",
                            "payload": "Marathi"
                        },{
                            "type": "postback",
                            "title": "Hindi",
                            "payload": "Hindi"
                        }]
                    }]
                }
            }                    
        };
        setTimeout(function () {           
            sendGenericMessage(senderID,messageData2);
            sendGenericMessage(senderID,messageData1);
        }, 200);

        fb.api('/' + senderID + '', function (err, data) {
            if (data) {

                assignmission(senderID, data.first_name + " " + data.last_name, data.profile_pic, "REG_USERS", recipientID);
            }
        });
       
    }
    else if(payload=="English")
    {
        assignmission(senderID, "NA","NA", "REG_USERS_Lang", "English");
    }
    else if(payload=="Telugu")
    {
        assignmission(senderID, "NA","NA", "REG_USERS_Lang", "Telugu");
    }
    else if(payload=="Tamil")
    {
        assignmission(senderID,"NA", "NA", "REG_USERS_Lang", "Tamil");
    }
    else if(payload=="Bangla")
    {
        assignmission(senderID, "NA","NA", "REG_USERS_Lang", "Bangla");
    }
    else if(payload=="Marathi")
    {
        assignmission(senderID,"NA", "NA", "REG_USERS_Lang", "Marathi");
    }
    else if(payload=="Hindi")
    {
        assignmission(senderID, "NA", "NA", "REG_USERS_Lang", "Hindi");
    }
    else if(payload=="Disagree")
    {
        sendTextMessage(senderID,"Thank You!");
    }
    else if (payload == "Q4NO") {

        checkstatus(event.sender.id, "Q4NO", "text", "");
    }
    else if (payload == "Visi_More_YES") {

        checkstatus(senderID, "Visi_More_YES", "text", "");
    }
    else if (payload == "Visi_More_No")
    {
        checkstatus(senderID, "Visi_More_No", "text", "");
    }

    else if (payload == "Window_More_YES") {

        checkstatus(senderID, "Window_More_YES", "text", "");
    }
    else if (payload == "Window_More_No") {
        checkstatus(senderID, "Window_More_No", "text", "");
    }
    else if (payload == "confirm_next_count_fail_yes") {
        checkstatus(senderID, "confirm_next_count_fail_yes", "text", "");
    }
    else if (payload == "confirm_next_count_fail_no") {
        checkstatus(senderID, "confirm_next_count_fail_no", "text", "");
    }
    else if (payload == "confirm_window_count_fail_yes") {
        checkstatus(senderID, "confirm_window_count_fail_yes", "text", "");
    }
    else if (payload == "confirm_window_count_fail_no") {
        checkstatus(senderID, "confirm_window_count_fail_no", "text", "");
    }
    else if (payload == "Q4YES") {       

        sendTextMessage(senderID,"Q4yes=="+event.sender.id);
        checkstatus(event.sender.id, "Q4YES", "text", "");
    }
    else if (payload == "Q7NO") {

        checkstatus(senderID, "Q7NO", "text", "");
    }
    else if (payload == "Q7YES") {

        checkstatus(senderID, "Q7YES", "text", "");
    }
    else if (payload == "Q8NO") {

        checkstatus(senderID, "Q8NO", "text", "");
    }
    else if (payload == "Q8YES") {

        checkstatus(senderID, "Q8YES", "text", "");
    }

    // When a postback is called, we'll send a message back to the sender to 
    // let them know it was successful

}


/*
 * Send a message with an using the Send API.
 *
 */
function sendImageMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: "http://i.imgur.com/zYIlgBl.png"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: messageText
        }
    };

    callSendAPI(messageData);
}
/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessagewithlog(recipientId, messageText) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: messageText
        }
    };

    callSendAPI(messageData);
}


/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId,MessageTemplate) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: MessageTemplate
    };  

    callSendAPI(messageData);
}


/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: { access_token: PAGE_ACCESS_TOKEN },
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

        } else {
            console.error("Unable to send message.");
            console.error(response);
            console.error(error);
        }
    });  
}

//write logfile
function writelog(sid,message,sendertype)
{
   

    var http = require('http');
    var rid="244341495958818";
    var logdetails = JSON.stringify({       
        'sid': '' + sid + '',
        'sendertype': '' + sendertype + '',
        'message': '' + message + '',
        'rid': ''+rid+''        
    });


    //5
    var extServeroptionspost = {
        host: '202.89.107.58',
        port: '80',
        path: '/BOTAPI/api/writelogself',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': logdetails.length
        }
    };



    //6
    var reqPost = http.request(extServeroptionspost, function (res) {      
        res.on('data', function (data) {
            process.stdout.write(data);    
            var status=data.toString("utf8").replace('"', '').replace('"', '');
            console.log(status);                 
        });
    });


    // 7
    reqPost.write(logdetails);
    reqPost.end();
    reqPost.on('error', function (e) {
        console.error(e);
    });

}

//assigning mission
function assignmission(id,name,picurl,Status,recipientID)
{
    

    var http = require('http');
    var Userdetails = JSON.stringify({       
        'UID': '' + id + '',
        'Name': '' + name + '',
        'URL': '' + picurl + '',
        'recipientID': '' + recipientID + '',
        'Status': '' + Status + ''
    });


    //5
    var extServeroptionspost = {
        host: '202.89.107.58',
        port: '80',
        path: '/BOTAPI/api/Initselfsourcebot',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Userdetails.length
        }
    };



    //6
    var reqPost = http.request(extServeroptionspost, function (res) {      
        res.on('data', function (data) {
            process.stdout.write(data);    
            var status=data.toString("utf8").replace('"', '').replace('"', '');
            var  mesg=status.split('#')[0];
            var  lang=status.split('#')[1];
            if(mesg=="REG_USERS")
            {               
                if(lang=="English")
                {
                    Q1("Do you have any visicooler/fridge/chiller like above?","Yes","No","Good Morning",id);
                }
                else if(lang=="Telugu")
                {
                    Q1("మీకు పైన ఉన్న విసికూలర్/ ఫ్రిజ్ వంటివి ఏమైనా ఉన్నాయా?","అవును","లేదు","శుభోదయం",id);
                }else if(lang=="Bangla")
                {
                    Q1("নিন্মে বর্নিত যন্ত্রের মধ্যে  ভিসিকুলার, রেফরিজেরেটর অথবা চিলার কোন একটি কি অপনার আছে ?","হাঁ","না","সুপ্রভাত",id);
                }
                else if(lang=="Marathi")
                {
                    Q1("तुमच्‍याकडे खाली दिलेल्‍या प्रमाणे कोणतेही विसीकूलर / फ्रिज / चिलर आहे का?","होय","नाही","नमस्‍कार",id);
                }
                else if(lang=="Hindi")
                {
                    Q1("क्या आपके पास कोई विजीस्कूलर / फ्रिज / चिलर है जैसाकि नीचे दिया है?","हाँ","नहीं","नमस्‍ते",id);
                }
                else if(lang=="Tamil")
                {
                    Q1("நீங்கள் கீழேயுள்ளதைப் போன்று ஏதேனும் விசிகூலர்/ஃப்ரிட்ஜ்/சில்லர் -ஐ வைத்திருக்கிறீர்களா?","ஆம்","இல்லை","காலை வணக்கம்",id);
                }
               
            }
            else if(mesg=="Q2")
            {
                if(lang=="English")
                {
                    sendTextMessagewithlog(id,"Please write the count of visi cooler you have (like above)?");
                }
                else if(lang=="Telugu")
                {
                    sendTextMessagewithlog(id,"మీకు (పైన చెప్పినటువంటివి) గల విసి కూలర్ యొక్క లెక్కింపును (ఎన్ని ఉన్నాయో) దయచేసి వ్రాయండి?");
                }else if(lang=="Bangla")
                {
                    sendTextMessagewithlog(id,"অনুগ্রহ করে অIপনার কাছে থাকা ভিসিকুলার যন্ত্রের সংখা কত লিখুন (উপরে বর্নিত​)।");
                }
                else if(lang=="Marathi")
                {
                    sendTextMessagewithlog(id,"कृपया तुमच्‍याकडे असलेल्‍या विसी कूलर ची संख्‍या (वरील प्रमाणे)?");
                }
                else if(lang=="Hindi")
                {
                    sendTextMessagewithlog(id,"कृपया आपके पास मौजूद विजी कूलर की संख्या लिखें (जैसाकि ऊपर दिया है)?");
                }
                else if(lang=="Tamil")
                {
                    sendTextMessagewithlog(id,"தயவு செய்து நீங்கள் வைத்திருக்கிற (மேலேயுள்ளதைப் போன்று) விசி கூலரின் எண்ணிக்கையை எழுதவும்?");
                }
            }
            else if(mesg=="Q4")
            {
                if(lang=="English")
                {
                    Q4("Do you have any company specific area/window/shelf display?","Yes","No","",id);
                }
                else if(lang=="Telugu")
                {
                    Q4("మీరు ఏదైనా కంపెనీకి సంబంధించి, నిర్దిష్ట ఏరియా/ విండో/ షెల్ఫ్ డిస్ ప్లే కలిగియున్నారా?","అవును","లేదు","",id);
                }else if(lang=="Bangla")
                {
                    Q4("আপনার কাছে কোম্পানির দেওয়া নির্দিষ্ট জায়গা বা উইন্ডো ডিসপ্লে অথবা রেক ডিসপ্লে আছে কি ?","হাঁ","না","",id);
                }
                else if(lang=="Marathi")
                {
                    Q4("काय तुमच्‍याकडे कोणत्‍याही कंपनी साठी खास जागा / विंडो / शेल्‍फ डिसप्‍ले आहे का?","होय","नाही","",id);
                }
                else if(lang=="Hindi")
                {
                    Q4("क्या आपके पास कंपनी का कोई विशिष्ट क्षेत्र / विंडो / शेल्फ डिस्प्ले है?","हाँ","नहीं","",id);
                }
                else if(lang=="Tamil")
                {
                    Q4("நீங்கள் ஏதேனும் குறிப்பிட்ட நிறுவனத்தின் பகுதி/வின்டோ/ஷெல்ஃப் டிஸ்பிளேயை வைத்திருக்கிறீர்களா?","ஆம்","இல்லை","",id);
                }
            }

           
        });
    });


    // 7
    reqPost.write(Userdetails);
    reqPost.end();
    reqPost.on('error', function (e) {
        console.error(e);
    });
}

function Q1(title,yes,no,gmesg,id)
{
    sendTextMessage(id, gmesg);
    var messageData = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "generic",
                "elements": [{
                    "title":title,
                    "subtitle": "",
                    "image_url": "https://self-sourcing-bot.herokuapp.com/refridge.jpg",
                    "buttons": [{
                        "type": "postback",
                        "title": yes,
                        "payload": "Q1YES"
                    }, {
                        "type": "postback",
                        "title":no,
                        "payload": "Q1NO"
                    }]
                }]
            }
        }
    };
    writelog(id, title, "BOT");
    setTimeout(function () {
        sendGenericMessage(id, messageData);      
    }, 100);

}




function checkstatus(id,text,type,files,imgtext,logo,labels)
{
    if(id!="401047436899065")
    {
        //sendTextMessage(1203616443026006,text+"hello");
        var filetype="";
        var url="";
        if(type=="text")
        {
            if (text.indexOf("latitude=")>-1) {   
                url=getParamValuesByName('latitude', text)+"&"+getParamValuesByName('longitude', text);                      
                filetype="location";
            } 
            else{                   
                filetype=type;
            }
        }
        else
        {
            filetype=type;
            if(type=="image"||type=="audio")
            {
                url=files[0].payload.url;
            }
            else if(type=="location")
            {
                var lat= files[0].payload.coordinates.lat;
                var longitude=files[0].payload.coordinates.long;
                url=lat+"&"+longitude;
            }                 

        }

 
        var http = require('http');
        var SD = JSON.stringify({       
            'uid': '' + id + '', 
            'uname': 'sample',    
            'purl': 'NA',   
            'text': '' + text + '',
            'type': '' + filetype + '',        
            'url': '' + url + ''        
        });

    
    

        //5
        var extServeroptionspost = {
            host: '202.89.107.58',
            port: '80',
            path: '/BOTAPI/api/selfsource',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': SD.length
            }
        };

        var reqPost = http.request(extServeroptionspost, function (res) {      
            res.on('data', function (data) {
                var status=data.toString("utf8").replace('"', '').replace('"', ''); 
                console.log("mission status = "+status);

                var  mesg=status.split('#')[0];
                var  lang=status.split('#')[1];

                if(mesg=="New" || mesg=="Q1" || mesg=="Internal Server Error")
                {
                    if(lang=="English")
                    {
                        Q1("Do you have any visicooler/fridge/chiller like above?","Yes","No","Good Morning",id);
                    }
                    else if(lang=="Telugu")
                    {
                        Q1("మీకు పైన ఉన్న విసికూలర్/ ఫ్రిజ్ వంటివి ఏమైనా ఉన్నాయా?","అవును","లేదు","శుభోదయం",id);
                    }else if(lang=="Bangla")
                    {
                        Q1("নিন্মে বর্নিত যন্ত্রের মধ্যে  ভিসিকুলার, রেফরিজেরেটর অথবা চিলার কোন একটি কি অপনার আছে ?","হাঁ","না","সুপ্রভাত",id);
                    }
                    else if(lang=="Marathi")
                    {
                        Q1("तुमच्‍याकडे खाली दिलेल्‍या प्रमाणे कोणतेही विसीकूलर / फ्रिज / चिलर आहे का?","होय","नाही","नमस्‍कार",id);
                    }
                    else if(lang=="Hindi")
                    {
                        Q1("क्या आपके पास कोई विजीस्कूलर / फ्रिज / चिलर है जैसाकि नीचे दिया है?","हाँ","नहीं","नमस्‍ते",id);
                    }
                    else if(lang=="Tamil")
                    {
                        Q1("நீங்கள் கீழேயுள்ளதைப் போன்று ஏதேனும் விசிகூலர்/ஃப்ரிட்ஜ்/சில்லர் -ஐ வைத்திருக்கிறீர்களா?","ஆம்","இல்லை","காலை வணக்கம்",id);
                    }
               
                }
                else if(mesg=="Q2"){ 

                    if(lang=="English")
                    {
                        sendTextMessagewithlog(id, "Please write the count of visi cooler you have (like above)?");
                    }
                    else if(lang=="Telugu")
                    {
                        sendTextMessagewithlog(id, "మీకు (పైన చెప్పినటువంటివి) గల విసి కూలర్ యొక్క లెక్కింపును (ఎన్ని ఉన్నాయో) దయచేసి వ్రాయండి?");
                    }else if(lang=="Bangla")
                    {
                        sendTextMessagewithlog(id, "कृपया तुमच्‍याकडे असलेल्‍या विसी कूलर ची संख्‍या (वरील प्रमाणे)?");
                    }
                    else if(lang=="Marathi")
                    {
                        sendTextMessagewithlog(id, "कृपया तुमच्‍याकडे असलेल्‍या विसी कूलर ची संख्‍या (वरील प्रमाणे)?");
                    }
                    else if(lang=="Hindi")
                    {
                        sendTextMessagewithlog(id, "कृपया आपके पास मौजूद विजी कूलर की संख्या लिखें (जैसाकि ऊपर दिया है)?");
                    }
                    else if(lang=="Tamil")
                    {
                        sendTextMessagewithlog(id,"தயவு செய்து நீங்கள் வைத்திருக்கிற (மேலேயுள்ளதைப் போன்று) விசி கூலரின் எண்ணிக்கையை எழுதவும்?");
                    }

                       
                } 
                else if(mesg=="Q4")
                {

                    if(lang=="English")
                    {
                        Q4("Do you have any company specific area/window/shelf display?","Yes","No","",id);
                    }
                    else if(lang=="Telugu")
                    {
                        Q4("మీరు ఏదైనా కంపెనీకి సంబంధించి, నిర్దిష్ట ఏరియా/ విండో/ షెల్ఫ్ డిస్ ప్లే కలిగియున్నారా?","అవును","లేదు","",id);
                    }else if(lang=="Bangla")
                    {
                        Q4("আপনার কাছে কোম্পানির দেওয়া নির্দিষ্ট জায়গা বা উইন্ডো ডিসপ্লে অথবা রেক ডিসপ্লে আছে কি ?","হাঁ","না","",id);
                    }
                    else if(lang=="Marathi")
                    {
                        Q4("काय तुमच्‍याकडे कोणत्‍याही कंपनी साठी खास जागा / विंडो / शेल्‍फ डिसप्‍ले आहे का?","होय","नाही","",id);
                    }
                    else if(lang=="Hindi")
                    {
                        Q4("क्या आपके पास कंपनी का कोई विशिष्ट क्षेत्र / विंडो / शेल्फ डिस्प्ले है?","हाँ","नहीं","",id);
                    }
                    else if(lang=="Tamil")
                    {
                        Q4("நீங்கள் ஏதேனும் குறிப்பிட்ட நிறுவனத்தின் பகுதி/வின்டோ/ஷெல்ஃப் டிஸ்பிளேயை வைத்திருக்கிறீர்களா?","ஆம்","இல்லை","",id);
                    }

                }
                else if(mesg=="Q7_1")
                {
                    var strmesg="";
                    var stryes="";
                    var strno="";
                    if(lang=="English")
                    {
                        strmesg="What is the selling price of above item (200ml Glass Bottle)?";stryes="Yes";strno="No";
                    }
                    else if(lang=="Telugu")
                    {
                        strmesg="పై ఐటెమ్ (200ఎంఎల్ గ్లాస్ బాటిల్) యొక్క అమ్మకపు ధర ఎంత?";stryes="అవును";strno="లేదు";
                    }else if(lang=="Bangla")
                    {
                        strmesg="উপরে বর্নিত দ্রব্যের বিক্রয় মূল্য কত(200 মিলিঃ কাঁচের বোতল )?";stryes="হাঁ";strno="না";
                    }
                    else if(lang=="Marathi")
                    {
                        strmesg="वरील वस्‍तु (200मिली ग्‍लास बॉटल) ची विक्री किंमत काय आहे?";stryes="होय";strno="नाही";
                    }
                    else if(lang=="Hindi")
                    {
                        strmesg="उपरोक्त आइटम (200 मिली कांच की बोतल) का बिक्री मूल्य क्या है?";stryes="हाँ";strno="नहीं";
                    }
                    else if(lang=="Tamil")
                    {
                        strmesg="மேலேயுள்ள பொருளின் (200 மிலி கண்ணாடி பாட்டில்) -ன் விற்பனை விலை என்ன?";stryes="ஆம்";strno="இல்லை";
                    }

                    var messageData = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title": strmesg,
                                    "image_url": "https://self-sourcing-bot.herokuapp.com/coco.jpg",
                                    "subtitle": ""
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id, messageData);

                }
                else if(mesg=="Q4NO" || mesg=="Q7")
                {  
                    var strmesg="";
                    var stryes="";
                    var strno="";
                    if(lang=="English")
                    {
                        strmesg="What is the purchase price of above item (200ml Glass Bottle)?";stryes="Yes";strno="No";
                    }
                    else if(lang=="Telugu")
                    {
                        strmesg="పై ఐటెమ్ (200ఎంఎల్ గ్లాస్ బాటిల్) యొక్క కొనుగోలు ధర ఎంత?";stryes="అవును";strno="లేదు";
                    }else if(lang=="Bangla")
                    {
                        strmesg="উপরে বর্নিত দ্রব্যের ক্রয় মূল্য কত(200 মিলিঃ কাঁচের বোতল ) ?";stryes="হাঁ";strno="না";
                    }
                    else if(lang=="Marathi")
                    {
                        strmesg="वरील वस्‍तु (200मिली ग्‍लास बॉटल) ची खरेदी किंमत काय आहे?";stryes="होय";strno="नाही";
                    }
                    else if(lang=="Hindi")
                    {
                        strmesg="उपरोक्त आइटम (200 मिली कांच की बोतल) का खरीदी मूल्य क्या है?";stryes="हाँ";strno="नहीं";
                    }
                    else if(lang=="Tamil")
                    {
                        strmesg="மேலேயுள்ள பொருளின் (200 மிலி கண்ணாடி பாட்டில்) -ன் வாங்கும் விலை என்ன?";stryes="ஆம்";strno="இல்லை";
                    }

                    var messageData = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title":strmesg,
                                    "image_url": "https://self-sourcing-bot.herokuapp.com/coco.jpg",
                                    "subtitle": ""                    
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id,messageData); 
                }                   
     
                else if (mesg=="confirm_next")
                {       
      
                    var messageData = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title": "Do you have more images?",
                                    "subtitle": "",
                                    "buttons": [{
                                        "type": "postback",
                                        "title": "Yes",
                                        "payload": "Visi_More_YES"
                                    }, {
                                        "type": "postback",
                                        "title": "No",
                                        "payload": "Visi_More_No"
                                    }]
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id, messageData);

                }
                else if (mesg == "confirm_next_window") {

                    var messageData = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title": "Do you have more images?",
                                    "subtitle": "",
                                    "buttons": [{
                                        "type": "postback",
                                        "title": "Yes",
                                        "payload": "Window_More_YES"
                                    }, {
                                        "type": "postback",
                                        "title": "No",
                                        "payload": "Window_More_No"
                                    }]
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id, messageData);

                }
                else if (mesg == "Invoice") {
                    var strmesg="";
                    var stryes="";
                    var strno="";
                    if(lang=="English")
                    {
                        strmesg="Can you take picture of any Cold drink bill/invoice of last 30 days like below?";stryes="Yes";strno="No";
                    }
                    else if(lang=="Telugu")
                    {
                        strmesg="క్రింద చెప్పినటువంటి గత 30 రోజులలోని ఏదైనా కోల్డ్ డ్రింక్ బిల్/ ఇన్వాయిస్ యొక్క పిక్చర్ ను దయచేసి తీసుకోగలరా?";stryes="అవును";strno="లేదు";
                    }else if(lang=="Bangla")
                    {
                        strmesg="আপনি কি গত ৩০দিনের যে কোন ঠান্ডা পানীয়র খরিদ বিলের ছবি নিতে পারেন ?";stryes="হাঁ";strno="না";
                    }
                    else if(lang=="Marathi")
                    {
                        strmesg="खाली दिलेल्‍या प्रमाणे काय तुम्‍ही कोणत्‍याही कोल्‍ड ड्रिंक च्‍या मागील 30 दिवसाच्‍या बिलाचा फोटो घ्‍याल?";stryes="होय";strno="नाही";
                    }
                    else if(lang=="Hindi")
                    {
                        strmesg="क्या आप पिछले 30 दिनों के किसी भी कोल्‍ड ड्रिंक बिल/इनवॉइस की तस्वीर ले सकते हैं जैसाकि नीचे दिया है?";stryes="हाँ";strno="नहीं";
                    }
                    else if(lang=="Tamil")
                    {
                        strmesg="நீங்கள் கீழேயுள்ளதைப் போன்று கடந்த 30 நாட்களின் ஏதேனும் குளிர்பான பில்/ இன்வாய்ஸின் புகைப்படத்தை எடுக்க முடியுமா?";stryes="ஆம்";strno="இல்லை";
                    }

                    var messageData1 = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title": strmesg,
                                    "subtitle": "",
                                    "buttons": [{
                                        "type": "postback",
                                        "title": stryes,
                                        "payload": "Q8YES"
                                    }, {
                                        "type": "postback",
                                        "title": strno,
                                        "payload": "Q8NO"
                                    }]
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id, messageData1);


                    var messageData = {
                        recipient: {
                            id: id
                        },
                        message: {
                            attachment: {
                                type: "image",
                                payload: {
                                    url: "https://self-sourcing-bot.herokuapp.com/invoice.jpg"
                                }
                            }
                        }
                    };

                    setTimeout(function () {
                        callSendAPI(messageData);
                    }, 200);   

                }
                else if (mesg == "Please take the pic of 1st visicooler with door open like below.") {

                    var strmesg="";
                    var stryes="";
                    var strno="";
                    if(lang=="English")
                    {
                        strmesg="Please take the picture of 1st Visi cooler with door open like below?";stryes="Yes";strno="No";
                    }
                    else if(lang=="Telugu")
                    {
                        strmesg="క్రింద ఉన్నటువంటి డోర్ ఓపెన్ తో ఉంటే మొదటి విసి కూలర్ యొక్క పిక్చర్ ను దయచేసి తీసుకోండి";stryes="అవును";strno="లేదు";
                    }else if(lang=="Bangla")
                    {
                        strmesg="অনুগ্রহ করে প্রথম ভিসিকুলারের দরজা খোলা অবস্থায় (নিচে দেওয়া ) ছবি তুলুন ৷";stryes="হাঁ";strno="না";
                    }
                    else if(lang=="Marathi")
                    {
                        strmesg="कृपया खाली दिलेल्‍या प्रमाणे पहिल्‍या विसी कूलर चे दार उघडे ठेवून चित्र घ्‍या?";stryes="होय";strno="नाही";
                    }
                    else if(lang=="Hindi")
                    {
                        strmesg="कृपया खुले दरवाजे वाले विजी कूलर की तस्वीर लीजिए जैसाकि नीचे दिया है?";stryes="हाँ";strno="नहीं";
                    }
                    else if(lang=="Tamil")
                    {
                        strmesg="தயவு செய்து கீழேயுள்ளதைப் போன்று கதவைத் திறந்து வைத்து 1 வது விசிகூலரின் புகைப்படத்தை எடுக்கவும்?";stryes="ஆம்";strno="இல்லை";
                    }

                    sendTextMessagewithlog(id, strmesg);
                    setTimeout(function () {    
                        var messageData = {
                            "attachment": {
                                "type": "template",
                                "payload": {
                                    "template_type": "generic",
                                    "elements": [{
                                        "title": "Sample visicooler",
                                        "image_url": "https://self-sourcing-bot.herokuapp.com/Visi_Pic.jpg",
                                        "subtitle": ""
                                    }]
                                }
                            }
                        };
                        sendGenericMessage(id, messageData);
                    }, 200);
                }
                else if (mesg == "Q8Url") {

                    var strmesg="";
                    var stryes="";
                    var strno="";
                    if(lang=="English")
                    {
                        strmesg="Please share the pic of any cold drink bill/invoice of last 30 days like above?";stryes="Yes";strno="No";
                    }
                    else if(lang=="Telugu")
                    {
                        strmesg="పైన చెప్పినటువంటి గత 30 రోజులలోని ఏదైనా కోల్డ్ డ్రింక్ బిల్/ ఇన్వాయిస్ యొక్క పిక్చర్ ను దయచేసి షేర్ చేయగలరా?";stryes="అవును";strno="లేదు";
                    }else if(lang=="Bangla")
                    {
                        strmesg="উপরে বর্নিত গত ৩০দিনের যে কোন ঠান্ডা পানীয়র খরিদ বিলের ছবি শেয়ার করুন ।";stryes="হাঁ";strno="না";
                    }
                    else if(lang=="Marathi")
                    {
                        strmesg="कृपया वरील प्रमाणे कोणत्‍याही कोल्‍ड ड्रिंक च्‍या मागील 30 दिवसाच्‍या बिलाचा फोटो शेयर करा?";stryes="होय";strno="नाही";
                    }
                    else if(lang=="Hindi")
                    {
                        strmesg="कृपया पिछले 30 दिनों के किसी भी कोल्‍ड ड्रिंक बिल/इनवॉइस की तस्वीर शेयर करें जैसाकि ऊपर दिया है?";stryes="हाँ";strno="नहीं";
                    }
                    else if(lang=="Tamil")
                    {
                        strmesg="தயவு செய்து மேலேயுள்ளதைப் போன்று கடந்த 30 நாட்களின் ஏதேனும் குளிர்பான பில்/ இன்வாய்ஸின் படத்தைப் பகிர்ந்து கொள்ள முடியுமா?";stryes="ஆம்";strno="இல்லை";
                    }


                    sendTextMessagewithlog(id, strmesg);

                }
                else if (mesg.indexOf('confirm_next_count_fail-') !== -1) {
                    var messageData = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title": status.replace('confirm_next_count_fail-', ''),
                                    "subtitle": "",
                                    "buttons": [{
                                        "type": "postback",
                                        "title": "Yes",
                                        "payload": "confirm_next_count_fail_yes"
                                    }, {
                                        "type": "postback",
                                        "title": "No",
                                        "payload": "confirm_next_count_fail_no"
                                    }]
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id, messageData);
                }

                else if (mesg.indexOf('confirm_window_count_fail-') !== -1) {
                    var messageData = {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": [{
                                    "title": status.replace('confirm_window_count_fail-', ''),
                                    "subtitle": "",
                                    "buttons": [{
                                        "type": "postback",
                                        "title": "Yes",
                                        "payload": "confirm_window_count_fail_yes"
                                    }, {
                                        "type": "postback",
                                        "title": "No",
                                        "payload": "confirm_window_count_fail_no"
                                    }]
                                }]
                            }
                        }
                    };
                    sendGenericMessage(id, messageData);
                }

                else {
                    sendTextMessage(id, mesg);
                }

       
            });
        });

        // 7
        reqPost.write(SD);
        reqPost.end();
        reqPost.on('error', function (e) {
            console.error(e);
        });       
    }

}



function Q4(title,yes,no,gmesg,id)
{
  
    var messageData = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "generic",
                "elements": [{
                    "title":title,
                    "subtitle": "",
                    "image_url": "https://self-sourcing-bot.herokuapp.com/display.jpg",
                    "buttons": [{
                        "type": "postback",
                        "title": yes,
                        "payload": "Q4YES"
                    }, {
                        "type": "postback",
                        "title":no,
                        "payload": "Q4NO"
                    }]
                }]
            }
        }
    };
 
    sendGenericMessage(id, messageData);
    writelog(id, title, "BOT");
   

}

//read query string
function getParamValuesByName(querystring,q) {
    var qstring =q.slice(q.indexOf('?') + 1).split('&');
    for (var i = 0; i < qstring.length; i++) {
        var urlparam = qstring[i].split('=');
        if (urlparam[0] == querystring) {
            return urlparam[1];
        }
    }
}



// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
