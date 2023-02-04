/* *
 * This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
 * Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
 * session persistence, api calls, and more.
 * */
 
const Alexa = require('ask-sdk-core');
const Axios = require('axios')
const AWS = require("aws-sdk");
const ddbAdapter = require('ask-sdk-dynamodb-persistence-adapter');
const moment = require('moment-timezone')

const EVENTS_URL = "https://content.googleapis.com/calendar/v3/calendars/primary/events";

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        let accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;

        if (accessToken === undefined){
            // The request did not include a token, so tell the user to link
            // accounts and return a LinkAccount card
            var speechText = "Please use the Alexa app to link your Google Account.";
    
            return handlerInput.responseBuilder
                .speak(speechText)
                .withLinkAccountCard()
                .withShouldEndSession(true)
                .getResponse();
        } 
        else {
            // Load saved attributes from DynamoDB and save them to the session attributes
            const attributesManager = handlerInput.attributesManager;
            const attributes = await attributesManager.getPersistentAttributes() || {};
            
            if (!attributes.hasOwnProperty('preferences')) {
                attributes.preferences = {}
            }

            attributesManager.setSessionAttributes(attributes);
        
            const preferences = attributes.preferences;
        
            let speechOutput = "Hi there! I can help you schedule an event or check if you have any upcoming events.";
            
            if (Object.keys(preferences).length === 0 && preferences.constructor === Object) {
                speechOutput += " You can let me know if you prefer to schedule certain types of events at certain times."
            }
        
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(speechOutput)
                .getResponse();
        }
    }
};

// Formats a time object from a Google API response to a readable format
function formatTimeObject(time) {
    let dateTime = new Date(time.dateTime)
    
    return moment.tz(dateTime, time.timeZone).format('hh:mm a');
}

// Formats a time string from a slot input to a readable format
function formatTime(time) {
    return moment(time, 'HH:mm').format('hh:mm a')
}

// Gets the user's timezone from the Alexa settings API
async function getUserTimeZone(handlerInput) {
    const apiAccessToken = handlerInput.requestEnvelope.context.System.apiAccessToken;
    const apiEndpoint = handlerInput.requestEnvelope.context.System.apiEndpoint;
    const deviceId = handlerInput.requestEnvelope.context.System.device.deviceId;
    
    const apiConfig = {
        headers: {'Authorization': 'Bearer ' + apiAccessToken}
    };
        
    let url = `${apiEndpoint}/v2/devices/${deviceId}/settings/System.timeZone`
    let resp = await Axios.get(url, apiConfig)
    let timeZone = resp.data
    
    return timeZone
}

// Returns the time of day for a specified time
function getTimeOfDay(time) {
    if (time < "05:00") {
        return "early morning"
    }
    if (time < "12:00") {
        return "morning"
    }
    else if (time < "17:00") {
        return "afternoon"
    }
    else if (time < "21:00") {
        return "evening"
    }
    else if (time < "24:00") {
        return "night"
    }
}

const GetEventsIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetEventsIntent';
    },
    async handle(handlerInput) {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        let speakOutput = '';
        
        try {
            // Get the user's Google access token
            let accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
            let currentDate = new Date()
            
            let tomorrow = new Date()
            tomorrow.setDate(tomorrow.getDate() + 1)
            // Convert dates to formats understood by Google API
            let timeMin = currentDate.toISOString()
            let timeMax = tomorrow.toISOString()
            // Request events from the Google API for the next 24 hours (ordered by start time)
            let url = `${EVENTS_URL}?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
            const config = {
              headers: {'Authorization': 'Bearer ' + accessToken}
            };
            
            let resp = await Axios.get(url, config);
            let events = resp.data.items
            let numEvents = events.length
            
            speakOutput = `You have ${numEvents} event${numEvents === 1 ? "" : "s"} in the next 24 hours.`
            
            if (numEvents > 0) {
                speakOutput += ` Would you like to hear what ${numEvents === 1 ? "it is" : "they are"}?`
            }
            // Save events to be used in YesIntentHandler
            sessionAttributes.previousIntent = "getEvents"
            sessionAttributes.events = events
        
        } catch (error) {
        console.log('Error getting events');
        console.error(error);
      }

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt()
            .getResponse();
    }
};

const SetPreferencesIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetPreferencesIntent';
    },
    async handle(handlerInput) {
        const slots = handlerInput.requestEnvelope.request.intent.slots
        let eventType = slots.eventType.value; 
        let time = slots.time.value; 
        let endTime = slots.timeEnd ? slots.timeEnd.value : slots.timeEnd
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes();
        let preferences = {}
        
        // Strip event or events off of input from slot
        if (eventType.substring(eventType.length - 6, eventType.length) === " event") {
            eventType = eventType.substring(0, eventType.length - 6)
        }
        else if (eventType.substring(eventType.length - 7, eventType.length) === " events") {
            eventType = eventType.substring(0, eventType.length - 7)
        }
        
        let speakOutput = `Okay, I'll remember that you prefer ${eventType} events to be `;
        
        // Define time ranges for times of day, or set specified range
        switch (time) {
            case "MO":
                speakOutput += "in the morning"
                time = "05:00"
                endTime = "11:00"
                break;
            case "AF":
                speakOutput += "in the afternoon"
                time = "12:00"
                endTime = "16:00"
                break;
            case "EV":
                speakOutput += "in the evening"
                time = "17:00"
                endTime = "20:00"
                break;
            case "NI":
                speakOutput += "at night"
                time = "21:00"
                endTime = "24:00"
                break;
            default:
                if (endTime) {
                    speakOutput += `from ${formatTime(time)} to ${formatTime(endTime)}`
                }
                else {
                    speakOutput += `at ${time}`
                    endTime = time
                }
        }
        // Save preferences to DynamoDB
        if (sessionAttributes.preferences) {
            preferences = sessionAttributes.preferences
        }
        
        preferences[eventType] = {
            start: time,
            end: endTime
        }
        
        sessionAttributes.preferences = preferences
        attributesManager.setSessionAttributes(sessionAttributes);
        attributesManager.setPersistentAttributes({preferences: sessionAttributes.preferences});
        await attributesManager.savePersistentAttributes();
        
        sessionAttributes.previousIntent = "setPreferences"
        sessionAttributes.eventType = eventType
        sessionAttributes.speakOutput = speakOutput

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
}

const ScheduleEventIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ScheduleEventIntent';
    },
    async handle(handlerInput) {
        let accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const eventType = handlerInput.requestEnvelope.request.intent.slots.eventType.value; 
        const date = handlerInput.requestEnvelope.request.intent.slots.date.value; 
        
        let speakOutput = ""
        let beginning = "00:00"
        let end = "23:59"
        // Update range to check for availability if preferences are set for this event type
        if (sessionAttributes.preferences[eventType]) {
            beginning = sessionAttributes.preferences[eventType].start
            end = sessionAttributes.preferences[eventType].end
        }
        // Set up the data needed for the API call
        let timeZone = await getUserTimeZone(handlerInput)
        let dateObj = moment.tz(`${date} ${beginning}`, timeZone)
        let dateObjMax = moment.tz(`${date} ${end}`, timeZone)
        
        let timeMin = dateObj.toISOString()
        let timeMax = dateObjMax.toISOString()
        // Request the events in the specified time period from the Google API
        let url = `${EVENTS_URL}?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
        const config = {
          headers: {'Authorization': 'Bearer ' + accessToken}
        };
        
        let resp = await Axios.get(url, config);
        let events = resp.data.items
        
        beginning = formatTime(beginning)
        end = formatTime(end)
        
        speakOutput = "Okay, you have availability"
        
        let availability = []
        let availabilityByTime = {
            morning: [],
            afternoon: [],
            evening: [],
            night: []
        }
        // Split up availability based on the time of day it is in
        for (let i = 0; i < events.length; i++) {
            let event = events[i]

            let startTime = moment(beginning, 'hh:mm a').format('HH:mm')
            let eventStartTime = moment.tz(event.start.dateTime, event.start.timeZone).format('HH:mm')
            if (eventStartTime > startTime) {
                let timeOfDayStart = getTimeOfDay(startTime)
                
                availability.push(`from ${beginning} to ${formatTimeObject(event.start)}`)
                availabilityByTime[timeOfDayStart].push(`from ${beginning} to ${formatTimeObject(event.start)}`)
            }
            
            beginning = formatTimeObject(event.end)
        }
        
        if (moment(beginning, 'hh:mm a').format('HH:mm') < moment(end, 'hh:mm a').format('HH:mm')) {
            availability.push(`from ${beginning} to ${end}`)
        }
        // Figure out which times of day have availability
        let availableTimesOfDay = []
        for (const timeOfDay in availabilityByTime) {
            if (availabilityByTime[timeOfDay].length) {
                availableTimesOfDay.push(timeOfDay)
            }
        }
        // If the user has no events
        if (events.length === 0) {
            // If the user does not have preferences set for this event
            if (beginning === formatTime("00:00") && end === formatTime("23:59")) {
                speakOutput = "You are available for the whole day. What time would you like to schedule the event for?"
            }
            else {
                speakOutput = `You are available from ${beginning} to ${end}. What time would you like to schedule the event for?`
            }
        }
        // If the user has no availability
        else if (availability.length === 0) {
            speakOutput = "You have no availability today."
        }
        // If the number of availability chunks is greater than 2, generalize by asking which time of day they prefer
        else if (availability.length > 2 && availableTimesOfDay.length > 1) {
            for (let i = 0; i < availableTimesOfDay.length; i++) {
                if (i === availableTimesOfDay.length - 1 && availableTimesOfDay.length !== 1) {
                        speakOutput += " and"
                }
                
                speakOutput += ` in the ${availableTimesOfDay[i]}`
                
                if (i !== availableTimesOfDay.length - 1 && availableTimesOfDay.length > 2) {
                        speakOutput += ","
                }
            }
            speakOutput += ". Which would you prefer?"
        }
        // Otherwise, just list the available chunks of time
        else {
            for (let i = 0; i < availability.length; i++) {
                if (i === availability.length - 1 && availability.length !== 1) {
                        speakOutput += " and"
                }
                speakOutput += ` ${availability[i]}`
                
                if (i !== availability.length - 1 && availability.length > 2) {
                        speakOutput += ","
                }
            }
            speakOutput += ". What time would you like to schedule the event for?"
        }
        
        sessionAttributes.previousIntent = "ScheduleEventIntent"
        sessionAttributes.date = date
        sessionAttributes.availabilityByTime = availabilityByTime
        sessionAttributes.speakOutput = speakOutput

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('What time would you like to schedule the event for?')
            .getResponse();
    }
};

const AddEventIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddEventIntent';
    },
    async handle(handlerInput) {
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const date = sessionAttributes.date
        const eventName = handlerInput.requestEnvelope.request.intent.slots.eventName.value; 
        const time = handlerInput.requestEnvelope.request.intent.slots.time.value; 
        const duration = handlerInput.requestEnvelope.request.intent.slots.duration.value;
        
        let timeZone = await getUserTimeZone(handlerInput)
        // Figure out the start and end time of the new event
        let start = moment(`${date} ${time}`, 'YYYY-MM-DD HH:mm')
        let end = moment(start).add(moment.duration(duration))
        // Format date strings for API call
        let startString = start.toISOString()
        startString = startString.substring(0, startString.length - 5)
        let endString = end.toISOString()
        endString = endString.substring(0, endString.length - 5)

        const config = {
          headers: {'Authorization': 'Bearer ' + accessToken}
        };
        // Send the Google API call to add the event to the calendar
        let resp = await Axios.post(EVENTS_URL, {
            start: {
                dateTime: startString,
                timeZone
            },
            end: {
                dateTime: endString,
                timeZone
            },
            summary: eventName
        }, config);
        // Tell the user what date and time the event was added for
        let formattedDate = start.format('MMMM Do, YYYY')
        let formattedTimeStart = start.format('hh:mm a')
        let formattedTimeEnd = end.format('hh:mm a')
        let speakOutput = `Okay, I added ${eventName} to your calendar for ${formattedDate} from ${formattedTimeStart} to ${formattedTimeEnd}.`
        // Set up session attributes so that the user can undo the action
        sessionAttributes.previousIntent = "addEvent"
        sessionAttributes.eventId = resp.data.id
        sessionAttributes.speakOutput = speakOutput
        delete sessionAttributes.date
        delete sessionAttributes.availabilityByTime

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

/*
    This intent is triggered when a user specifies a time of day. It is meant to be used with the
    ScheduleEventIntent when there are too many available time chunks to list. The intent will
    generalize by asking first which time of day they prefer and this intent will give them
    the available times for that time of day.
*/
const TimeOfDayIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'TimeOfDayIntent';
    },
    handle(handlerInput) {
        const timeOfDay = handlerInput.requestEnvelope.request.intent.slots.timeOfDay.value; 
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const availabilityByTime = sessionAttributes.availabilityByTime
        let speakOutput = 'You have availability';
        // Tell the user the available times for the time of day they specified
        let availability = availabilityByTime[timeOfDay]
        for (let i = 0; i < availability.length; i++) {
            if (i === availability.length - 1 && availability.length !== 1) {
                speakOutput += " and"
            }
            
            speakOutput += ` ${availability[i]}`
            
            if (i !== availability.length - 1 && availability.length > 2) {
                speakOutput += ","
            }
        }
        speakOutput += ". What time would you like to schedule the event for?"
        sessionAttributes.speakOutput = speakOutput

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('What time would you like to schedule the event for?')
            .getResponse();
    }
};

const GetPreferencesIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetPreferencesIntent';
    },
    handle(handlerInput) {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const preferences = sessionAttributes.preferences;
        let speakOutput = "You prefer to have"
        let eventTypes = Object.keys(preferences)
        
        if (eventTypes.length === 0) {
            speakOutput = "You have no preferences"
        }
        // Tell the user what the preferences they have saved are
        for (let i = 0; i < eventTypes.length; i++) {
            let eventType = eventTypes[i]
            let start = preferences[eventType].start
            let end = preferences[eventType].end
            
            if (i === eventTypes.length - 1 && eventTypes.length !== 1) {
                    speakOutput += " and"
            }
            
            if (start === end) {
                speakOutput += ` ${eventType} events at ${formatTime(start)}`
            }
            else {
                speakOutput += ` ${eventType} events from ${formatTime(start)} to ${formatTime(end)}`
            }
            
            if (i !== eventTypes.length - 1 && eventTypes.length > 2) {
                    speakOutput += ","
            }
        }

        sessionAttributes.speakOutput = speakOutput
        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

const RecurringEventIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RecurringEventIntent';
    },
    async handle(handlerInput) {
        const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
        const eventName = handlerInput.requestEnvelope.request.intent.slots.eventName.value;
        const frequency = handlerInput.requestEnvelope.request.intent.slots.frequency.value; 
        const startDate = handlerInput.requestEnvelope.request.intent.slots.startDate.value; 
        const endDate = handlerInput.requestEnvelope.request.intent.slots.endDate.value; 
        const timeZone = await getUserTimeZone(handlerInput)
        
        let startString = new Date(startDate).toISOString()
        startString = startString.substring(0, startString.length - 5)
        let endString = new Date(endDate).toISOString()
        endString = endString.substring(0, endString.length - 5)
        
        let day = frequency.toUpperCase().substring(0, 2)
        let until = moment(endDate).format('YYYYMMDD')
        
        const config = {
          headers: {'Authorization': 'Bearer ' + accessToken}
        };
        // Send the Google API call to add a recurring event
        let resp = await Axios.post(EVENTS_URL, {
            start: {
                dateTime: startString,
                timeZone
            },
            end: {
                dateTime: startString,
                timeZone
            },
            summary: eventName,
            recurrence: [
                `RRULE:FREQ=WEEKLY;UNTIL=${until};BYDAY=${day}`    
            ]
        }, config);

        const speakOutput = "Okay, I've added the event to your calendar";
        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

const YesIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent';
    },
    handle(handlerInput) {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        let speakOutput = '';
        // If the user is replying to the prompt from the GetEventsIntentHandler
        if (sessionAttributes.previousIntent && sessionAttributes.previousIntent === "getEvents") {
            let events = sessionAttributes.events
            let numEvents = events.length
            // Tell the user what events they have coming up
            for (let i = 0; i < numEvents; i++) {
                let event = events[i]
                
                if (i === 0) {
                    speakOutput += "You have"
                }
                
                if (i === numEvents - 1 && numEvents !== 1) {
                    speakOutput += " and"
                }
            
                speakOutput += ` ${event.summary} from ${formatTimeObject(event.start)} to ${formatTimeObject(event.end)}`
            
                if (i !== numEvents - 1 && numEvents > 2) {
                    speakOutput += ","
                }
            }    
            delete sessionAttributes.previousIntent
            delete sessionAttributes.events
        }

        sessionAttributes.speakOutput = speakOutput
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const NoIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent';
    },
    async handle(handlerInput) {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const previousIntent = sessionAttributes.previousIntent
        let speakOutput = 'Okay';
        console.log(previousIntent)
        switch (previousIntent) {
            // If the user says no after a preference has bee set, undo it
            case "setPreferences":
                speakOutput += ", I'll undo that"
                delete sessionAttributes.preferences[sessionAttributes.eventType]
                delete sessionAttributes.previousIntent
                
                handlerInput.attributesManager.setPersistentAttributes({preferences: sessionAttributes.preferences});
                await handlerInput.attributesManager.savePersistentAttributes();
                break;
            case "getEvents":
                delete sessionAttributes.previousIntent
                delete sessionAttributes.events
                break;
            // If the user says no after an event has been added, delete it
            case "addEvent":
                speakOutput += ", I'll undo that"
                const accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
                let url = `${EVENTS_URL}/${sessionAttributes.eventId}`
                const config = {
                  headers: {'Authorization': 'Bearer ' + accessToken}
                };
                
                let resp = await Axios.delete(url, config);
                delete sessionAttributes.previousIntent
                delete sessionAttributes.eventId
                break;
            default:
                delete sessionAttributes.previousIntent
        }

        sessionAttributes.speakOutput = speakOutput

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const RepeatIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.RepeatIntent';
    },
    handle(handlerInput) {
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        let speakOutput = sessionAttributes.speakOutput;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const HelloWorldIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'HelloWorldIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Hello World!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Hi there! I can help you schedule an event or check if you have any upcoming events. You can also let me know if you prefer to schedule certain types of events at certain times.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'Goodbye!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Sorry, I don\'t know about that. I can help you schedule an event or tell you your upcoming events.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    async handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.error(`Error handled: ${error.message}`);
        console.error(`Error stack: ${error.stack}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        GetEventsIntentHandler,
        SetPreferencesIntentHandler,
        ScheduleEventIntentHandler,
        AddEventIntentHandler,
        TimeOfDayIntentHandler,
        GetPreferencesIntentHandler,
        RecurringEventIntentHandler,
        HelloWorldIntentHandler,
        YesIntentHandler,
        NoIntentHandler,
        RepeatIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withCustomUserAgent('sample/hello-world/v1.2')
    .withPersistenceAdapter(
        new ddbAdapter.DynamoDbPersistenceAdapter({
            tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME,
            createTable: false,
            dynamoDBClient: new AWS.DynamoDB({apiVersion: 'latest', region: process.env.DYNAMODB_PERSISTENCE_REGION})
        })
    )
    .lambda();