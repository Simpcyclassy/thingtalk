// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const Q = require('q');
Q.longStackSupport = true;

const SchemaRetriever = require('../lib/schema');
const assert = require('assert');

const Formatter = require('../lib/runtime/formatter');
const builtin = require('../lib/builtin/values');

const _mockSchemaDelegate = require('./mock_schema_delegate');
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);


const TEST_CASES = [
    ['com.xkcd:get_comic', { number: 1234, title: 'Douglas Engelbart (1925-2013)',
          link: 'https://xkcd.com/1234/',
          picture_url: 'https://imgs.xkcd.com/comics/douglas_engelbart_1925_2013.png',
          alt_text: 'some alt text' }, null,
    [ { type: 'rdl',
        callback: 'https://xkcd.com/1234/',
        webCallback: 'https://xkcd.com/1234/',
        displayTitle: 'Douglas Engelbart (1925-2013)',
        displayText: undefined },
      { type: 'picture',
        url: 'https://imgs.xkcd.com/comics/douglas_engelbart_1925_2013.png' },
      'some alt text' ]
    ],

    ['com.xkcd:get_comic', { number: 1234, title: 'Douglas Engelbart (1925-2013)',
          link: 'https://xkcd.com/1234/',
          picture_url: 'https://imgs.xkcd.com/comics/douglas_engelbart_1925_2013.png',
          alt_text: 'some alt text' }, 'string',
    `Link: Douglas Engelbart (1925-2013) <https://xkcd.com/1234/>
Picture: https://imgs.xkcd.com/comics/douglas_engelbart_1925_2013.png
some alt text`,
    ],

    ['org.thingpedia.weather:current',
        { location: new builtin.Location(37, -113, "Somewhere"),
          temperature: 21,
          wind_speed: 5,
          humidity: 60,
          cloudiness: 0,
          fog: 0,
          status: 'sunny',
          icon: 'http://example.com/sunny.png'
        }, null,
    [ 'Current weather for Somewhere: sunny, temperature 21 C, wind speed 5 m/s, humidity 60%, cloudiness 0%, fog 0%.' ]
    ],

    ['org.thingpedia.weather:current',
        { location: new builtin.Location(37, -113, "Somewhere"),
          temperature: 21,
          wind_speed: 5,
          humidity: 60,
          cloudiness: 0,
          fog: 0,
          status: 'sunny',
          icon: 'http://example.com/sunny.png'
        }, 'string',
    'Current weather for Somewhere: sunny, temperature 21 C, wind speed 5 m/s, humidity 60%, cloudiness 0%, fog 0%.'
    ],

    ['org.thingpedia.weather:current',
        { location: new builtin.Location(37, -113),
          temperature: 21,
          wind_speed: 5,
          humidity: 60,
          cloudiness: 0,
          fog: 0,
          status: 'sunny',
          icon: 'http://example.com/sunny.png'
        }, 'string',
    'Current weather for [Latitude: 37 deg, Longitude: -113 deg]: sunny, temperature 21 C, wind speed 5 m/s, humidity 60%, cloudiness 0%, fog 0%.'
    ],


    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: false,
        has_motion: false,
        has_sound: false,
        picture_url: 'http://example.com/security-camera.jpg'
    }, null,
    [ 'Something detected on your camera at 5/24/2018, 11:04:00 AM',
      { type: 'picture',
        url: 'http://example.com/security-camera.jpg' } ]
    ],

    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: false,
        has_motion: false,
        has_sound: false,
        picture_url: 'http://example.com/security-camera.jpg'
    }, 'string',
    `Something detected on your camera at 5/24/2018, 11:04:00 AM
Picture: http://example.com/security-camera.jpg`
    ],

    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: true,
        has_motion: false,
        has_sound: false,
        picture_url: 'http://example.com/security-camera.jpg'
    }, null,
    [ 'Person detected on your camera at 5/24/2018, 11:04:00 AM',
      { type: 'picture',
        url: 'http://example.com/security-camera.jpg' } ]
    ],

    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: true,
        has_motion: true,
        has_sound: false,
        picture_url: 'http://example.com/security-camera.jpg'
    }, null,
    [ 'Person detected on your camera at 5/24/2018, 11:04:00 AM',
      { type: 'picture',
        url: 'http://example.com/security-camera.jpg' } ]
    ],

    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: false,
        has_motion: true,
        has_sound: false,
        picture_url: 'http://example.com/security-camera.jpg'
    }, null,
    [ 'Motion detected on your camera at 5/24/2018, 11:04:00 AM',
      { type: 'picture',
        url: 'http://example.com/security-camera.jpg' } ]
    ],

    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: false,
        has_motion: false,
        has_sound: true,
        picture_url: 'http://example.com/security-camera.jpg'
    }, null,
    [ 'Sound detected on your camera at 5/24/2018, 11:04:00 AM',
      { type: 'picture',
        url: 'http://example.com/security-camera.jpg' } ]
    ],

    ['org.thingpedia.builtin.thingengine.builtin:get_time',
      {time: new Date(2018, 4, 24, 11, 4, 0) }, null,
    [ 'Current time is 11:04:00 AM PDT.' ]
    ],

    ['org.thingpedia.builtin.thingengine.builtin:get_date',
      {date: new Date(2018, 4, 24, 11, 4, 0) }, null,
    [ 'Today is Thursday, May 24, 2018.' ]
    ],

    [`count(com.bing:web_search)`, {
        count: 7,
    }, null,
    [ 'I found 7 results.' ]
    ],

    [`count(com.bing:web_search)`, {
        count: 1,
    }, null,
    [ 'I found 1 result.' ]
    ],

    [`count(com.bing:web_search)`, {
        title: 7,
    }, null,
    [ 'I found 7 distinct values of title.' ]
    ],

    [`count(com.bing:web_search)`, {
        title: 1,
    }, null,
    [ 'I found only one value of title.' ]
    ],

    [`max(com.google.drive:list_drive_files)`, {
        file_size: 7,
    }, null,
    [ 'The maximum file size is 7.' ]
    ],

    [`min(com.google.drive:list_drive_files)`, {
        file_size: 7,
    }, null,
    [ 'The minimum file size is 7.' ]
    ],

    [`avg(com.google.drive:list_drive_files)`, {
        file_size: 7,
    }, null,
    [ 'The average file size is 7.' ]
    ],

    [`sum(com.google.drive:list_drive_files)`, {
        file_size: 7,
    }, null,
    [ 'The total file size is 7.' ]
    ],

    ['com.wikicfp:search', {
        start: new Date('TBD'),
        end: new Date('TBD'),
        deadline: new Date(2019, 2,4 ),
        link: 'http://www.abc.com',
        name: 'Some Computer Conference',
        abbr: 'SCC',
        city: 'North Pole'
    }, null,
    [ { type: 'rdl',
        callback: 'http://www.abc.com',
        webCallback: 'http://www.abc.com',
        displayTitle: 'Some Computer Conference (SCC)',
        displayText: 'Where: North Pole,\nWhen: N/A - N/A,\nDeadline: Monday, March 4, 2019.' } ]
    ],


    // when all parameters are undefined/null, do not include the output
    ['org.thingpedia.weather:current',
        { location: undefined,
            temperature: undefined,
            wind_speed: null,
            humidity: null,
            cloudiness: undefined,
            fog: undefined,
            status: undefined,
            icon: undefined,
        }, null,
        [ ]
    ],

    // when picture_url is undefined, do not output picture
    ['com.nest.security_camera:current_event', {
        start_time: new Date(2018, 4, 24, 11, 4, 0),
        has_person: false,
        has_motion: false,
        has_sound: false,
        picture_url: undefined
    }, null,
        [ 'Something detected on your camera at 5/24/2018, 11:04:00 AM' ]
    ],

    // when displayTitle and displayText are missing, only return a link
    ['com.wikicfp:search', {
        start: new Date('TBD'),
        end: new Date('TBD'),
        deadline: new Date('TBD'),
        link: 'http://www.abc.com',
        name: undefined,
        abbr: undefined,
        city: undefined
    }, null,
    [ { type: 'rdl',
        callback: 'http://www.abc.com',
        webCallback: 'http://www.abc.com',
        displayTitle: 'http://www.abc.com',
        displayText: null } ]
    ],

    ['org.wikidata:city', {
        id: 'palo alto',
        number_of_households: 100
    }, null,
    [
     'The number of households of palo alto is 100.']
    ],

    ['sum(org.wikidata:city)', {
        twinned_administrative_body: 10
    }, null,
    ['The total twin towns is 10.']
    ],

    ['com.yelp:restaurant', {
        rating: 3.5,
        id: new builtin.Entity("r6RztnVjcMq8wqI8o9ra_A", "Reposado")
    }, null,
    ['The rating of Reposado is 3.5.']
    ],
];

const gettext = {
    locale: 'en-US',
    dgettext: (domain, msgid) => msgid,
    dngettext: (domain, msgid, msgid_plural, n) => n === 1 ? msgid : msgid_plural,
};

const formatter = new Formatter('en-US', 'America/Los_Angeles', schemaRetriever, gettext);

function test(i) {
    console.log('Test Case #' + (i+1));

    let [outputType, outputValues, hint, expected] = TEST_CASES[i];

    return Q.try(() => {
        return formatter.formatForType(outputType, outputValues, hint).then((generated) => {
            try {
                assert.strictEqual(JSON.stringify(generated), JSON.stringify(expected));
            } catch(e) {
                console.log(generated);
                throw e;
            }
        });
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
        if (process.env.TEST_MODE)
            throw e;
    });
}

function loop(i) {
    if (i === TEST_CASES.length)
        return Q();

    return Q(test(i)).then(() => loop(i+1));
}
function main() {
    return loop(0);
}
module.exports = main;
if (!module.parent)
    main();
