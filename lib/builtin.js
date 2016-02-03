// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const adt = require('adt');
const Immutable = require('immutable');

const Type = require('./type');

function objectToString(o) {
    if (Array.isArray(o))
        return o.join(', ');
    else
        return String(o);
}

function equalityTest(a, b) {
    if (a === b)
        return true;
    if (a instanceof Date && b instanceof Date)
        return +a === +b;
    if (a !== null && typeof a === 'object' &&
        a.feedId !== undefined &&
        b !== null && typeof b === 'object' &&
        a.feedId === b.feedId)
        return true;

    return Immutable.is(a, b);
}

module.exports.equality = equalityTest;

function likeTest(a, b) {
    return a.indexOf(b) >= 0;
}

module.exports.BinaryOps = {
    '+': {
        types: [[Type.Measure(''), Type.Measure(''), Type.Measure('')],
                [Type.Number, Type.Number, Type.Number],
                [Type.String, Type.String, Type.String]],
        op: function(a, b) { return a + b; }
    },
    '-': {
        types: [[Type.Measure(''), Type.Measure(''), Type.Measure('')],
                [Type.Number, Type.Number, Type.Number],
                [Type.Date, Type.Date, Type.Measure('ms')]],
        op: function(a, b) { return (+a) - (+b); }
    },
    '*': {
        types: [[Type.Measure(''), Type.Number, Type.Measure('')],
                [Type.Number, Type.Measure(''), Type.Measure('')],
                [Type.Number, Type.Number, Type.Number]],
        op: function(a, b) { return a * b; },
    },
    '/': {
        types: [[Type.Measure(''), Type.Measure(''), Type.Number],
                [Type.Number, Type.Number, Type.Number]],
        op: function(a, b) { return a / b; },
    },
    '&&': {
        types: [[Type.Boolean, Type.Boolean, Type.Boolean]],
        op: function(a, b) { return a && b; }
    },
    '||': {
        types: [[Type.Boolean, Type.Boolean, Type.Boolean]],
        op: function(a, b) { return a && b; }
    },
    '>': {
        types: [[Type.String, Type.String, Type.Boolean],
                [Type.Measure(''), Type.Measure(''), Type.Boolean],
                [Type.Number, Type.Number, Type.Boolean],
                [Type.Date, Type.Date, Type.Boolean]],
        op: function(a, b) { return a > b; },
    },
    '<': {
        types: [[Type.String, Type.String, Type.Boolean],
                [Type.Measure(''), Type.Measure(''), Type.Boolean],
                [Type.Number, Type.Number, Type.Boolean],
                [Type.Date, Type.Date, Type.Boolean]],
        op: function(a, b) { return a < b; },
        reverse: '<',
    },
    '>=': {
        types: [[Type.String, Type.String, Type.Boolean],
                [Type.Measure(''), Type.Measure(''), Type.Boolean],
                [Type.Number, Type.Number, Type.Boolean],
                [Type.Date, Type.Date, Type.Boolean]],
        op: function(a, b) { return a >= b; },
        reverse: '<=',
    },
    '<=': {
        types: [[Type.String, Type.String, Type.Boolean],
                [Type.Measure(''), Type.Measure(''), Type.Boolean],
                [Type.Number, Type.Number, Type.Boolean],
                [Type.Date, Type.Date, Type.Boolean]],
        op: function(a, b) { return a <= b; },
        reverse: '>=',
    },
    '=': {
        types: [[Type.Any, Type.Any, Type.Any]],
        op: equalityTest,
        reverse: '=',
    },
    '!=': {
        types: [[Type.Any, Type.Any, Type.Any]],
        op: function(a, b) { return !(equalityTest(a,b)); },
        reverse: '=',
    },
    '=~': {
        types: [[Type.String, Type.String, Type.String]],
        op: likeTest,
        reverse: null,
    }
};

module.exports.UnaryOps = {
    '!': {
        types: [[Type.Boolean, Type.Boolean]],
        op: function(a) { return !a; }
    },
    '-': {
        types: [[Type.Measure(''), Type.Measure('')],
                [Type.Number, Type.Number]],
        op: function(a) { return -a; }
    }
};

module.exports.Functions = {
    'append': {
        types: [[Type.Array('a'), 'a', Type.Array('a')]],
        op: function(a, b) {
            if (Array.isArray(a))
                a = new Immutable.List(a);
            return a.push(b);
        },
    },
    'remove': {
        types: [[Type.Array('a'), 'a', Type.Array('a')],
                [Type.Map('k', 'v'), 'k', Type.Map('k', 'v')]],
        op: [function(a, b) {
            return a.filter(function(e) {
                return !equalityTest(e, b);
            });
        }, function(a, b) {
            if (!(a instanceof Immutable.Map))
                a = new Immutable.Map(a);
            return a.delete(key);
        }],
    },
    'emptyMap': {
        types: [[Type.Map(Type.Any, Type.Any)]],
        op: function() {
            return new Immutable.Map();
        }
    },
    'lookup': {
        types: [[Type.Map('k', Type.Array('a')), 'k', Type.Array('a')],
                [Type.Map('k', 'v'), 'k', 'v']],
        op: [function(a, b) {
            if (!(a instanceof Immutable.Map))
                a = new Immutable.Map(a);
            return a.get(b, []);
        }, function(a, b) {
            if (!(a instanceof Immutable.Map))
                a = new Immutable.Map(a);
            return a.get(b, null);
        }],
    },
    'insert': {
        types: [[Type.Map('k', 'v'), 'k', 'v', Type.Map('k', 'v')]],
        op: function(a, b, c) {
            if (!(a instanceof Immutable.Map))
                a = new Immutable.Map(a);
            return a.set(b, c);
        },
    },
    'values': {
        types: [[Type.Map('k', 'v'), Array('v')]],
        op: function(a) {
            if (!(a instanceof Immutable.Map))
                a = new Immutable.Map(a);
            return a.valueSeq();
        }
    },
    'regex': {
        types: [[Type.String, Type.String, Type.String, Type.Boolean]],
        minArgs: 2,
        op: function(a, b, c) {
            return (new RegExp(b, c)).test(a);
        },
    },
    'contains': {
        types: [[Type.Array('a'), 'a', Type.Boolean],
                [Type.Map('k', 'v'), 'k', Type.Boolean]],
        op: [function(a, b) {
            if (Array.isArray(a))
                return a.some(function(x) { return equalityTest(x, b); });
            else
                return a.has(b);
        }, function(a, b) {
            if (Array.isArray(a))
                return a.some(function(x) { return equalityTest(x[0], b); });
            else
                return a.has(b);
        }],
    },
    'distance': {
        types: [[Type.Location, Type.Location, Type.Measure('m')]],
        op: function(a, b) {
            return Math.sqrt((a.x - b.x)*(a.x - b.x) + (a.y - b.y)*(a.y - b.y));
        }
    },
    'toString': {
        types: [[Type.Any, Type.String]],
        op: objectToString,
    },
    'valueOf': {
        types: [[Type.String, Type.Number]],
        op: parseFloat,
    },
    'julianday': {
        types: [[Type.Date, Type.Number]],
        op: function(date) {
            return Math.floor((date.getTime() / 86400000) + 2440587.5);
        },
    },
    'today': {
        types: [[Type.Number]],
        op: function() {
            return Functions.julianday.op(new Date);
        }
    },
    'now': {
        types: [[Type.Date]],
        op: function() {
            return new Date;
        },
    },
    'floor': {
        types: [[Type.Number, Type.Number]],
        op: function(v) {
            return Math.floor(v);
        }
    },

    'sum': {
        types: [[Type.Array(Type.Number), Type.Number],
                [Type.Array(Type.Measure('')), Type.Measure('')]],
        op: function(values) {
            return values.reduce(function(v1, v2) { return v1 + v2; }, 0);
        }
    },

    'avg': {
        types: [[Type.Array(Type.Number), Type.Number],
                [Type.Array(Type.Measure('')), Type.Measure('')]],
        op: function(values) {
            var sum = values.reduce(function(v1, v2) { return v1 + v2; }, 0);
            if (values instanceof Immutable.Collection)
                return sum / values.count();
            else
                return sum / values.length;
        }
    },

    'concat': {
        types: [[Type.Array(Type.Any), Type.String, Type.String]],
        minArgs: 1,
        op: function(values, joiner) {
            return values.map(objectToString).join(joiner);
        }
    },

    'count': {
        types: [[Type.Array(Type.Any), Type.Number],
                [Type.Map(Type.Any, Type.Any), Type.Number]],
        tuplelength: -1,
        argtypes: [Type.Any],
        rettype: Type.Number,
        extratypes: [],
        op: function(values) {
            if (values instanceof Immutable.Collection)
                return values.count();
            else
                return values.length;
        }
    },

    'argMin': {
        types: [[Type.Array(Type.Any), Type.Number],
                [Type.Map('k', Type.Any), 'k']],
        op: function(values) {
            return (new Immutable.Seq(values)).reduce(function(state, value, key) {
                if (state.who === null || value < state.best)
                    return { who: key, best: value };
                else
                    return state;
            }, { best: null, who: null }).who;
        }
    },

    'argMax': {
        types: [[Type.Array(Type.Any), Type.Number],
                [Type.Map('k', Type.Any), 'k']],
        op: function(values) {
            return (new Immutable.Seq(values)).reduce(function(state, value, key) {
                if (state.who === null || value > state.best)
                    return { who: key, best: value };
                else
                    return state;
            }, { best: null, who: null }).who;
        }
    },
};

module.exports.Triggers = {
    'timer': [Type.Measure('ms')],
    'at': [Type.String],
    'input': [Type.Any],
};

module.exports.Actions = {
    'return': null, // no schema
    'notify': null, // no schema
    'logger': [Type.String],
};