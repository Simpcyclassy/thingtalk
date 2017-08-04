// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

function clean(name) {
    if (name.startsWith('v_'))
        name = name.substr('v_'.length);
    return name.replace(/_/g, ' ').replace(/([^A-Z])([A-Z])/g, '$1 $2').toLowerCase();
}

function coin(bias) {
    return Math.random() < bias;
}

function displayLocation(_, loc) {
    if (loc.isAbsolute) {
        if (loc.display)
            return loc.display;
        else
            return '[Latitude: ' + Number(loc.lat).toFixed(3) + ' deg, Longitude: ' + Number(loc.lon).toFixed(3) + ' deg]'
    } else {
        switch (loc.relativeTag) {
        case 'current_location':
            return _("here");
        case 'home':
            return _("at home");
        case 'work':
            return _("at work");
        default:
            return loc.relativeTag;
        }
    }
}

function describeDate(date, applyHeuristics) {
    if (applyHeuristics) {
        if (date.getHours() === 0 && date.getMinutes() === 0)
            return date.toLocaleDateString();
    }
    return date.toLocaleString();
}

function describeArg(_, arg, scope = {}, applyHeuristics = false) {
    if (arg.display)
        return arg.display;
    if (arg.isVarRef) {
        let name;
        if (arg.name in scope)
            name = scope[arg.name];
        else
            name = clean(arg.name);
        if (applyHeuristics) {
            if (coin(0.1))
                return _("the %s value").format(name);
            else if (coin(0.5))
                return _("the %s").format(name);
            else
                return _("its %s").format(name);
        } else {
            return name;
        }
    }
    if (arg.isUndefined)
        return '____';
    if (arg.isEvent) {
        if (applyHeuristics) {
            switch (arg.name) {
            case null:
                if (coin(0.5))
                    return _("the result");
                else
                    return _("it");
            case 'title':
                if (coin(0.5))
                    return _("the notification");
                else
                    return _("the result title");
            case 'body':
                return _("the notification body");
            }
        } else {
            switch (arg.name) {
            case null:
                return _("the event");
            case 'title':
                return _("the event's title");
            case 'body':
                return _("the event's long description");
            default:
                return arg.name;
            }
        }
    }
    if (arg.isLocation)
        return displayLocation(_, arg.value);
    if (arg.isString)
        return '"' + arg.value + '"';
    if (arg.isEntity) {
        if (arg.type === 'tt:username' || arg.type === 'tt:contact_name')
            return '@' + arg.value;
        if (arg.type === 'tt:hashtag')
            return '#' + arg.value;
        return arg.value;
    }
    if (arg.isNumber)
        return arg.value;
    if (arg.isEnum)
        return clean(arg.value);
    if (arg.isMeasure)
        return arg.value + ' ' + arg.unit;
    if (arg.isBoolean) {
        if (applyHeuristics && coin(0.5))
            return arg.value ? _("yes") : _("no");
        else
            return arg.value ? _("true") : _("false");
    }
    if (arg.isDate)
        return describeDate(arg.value, applyHeuristics);
    if (arg.isTime)
        return "%02d:%02d".format(arg.hour, arg.minute);

    return String(arg);
}

function describePlaceholder(_, type, applyHeuristics = false) {
    if (!applyHeuristics)
        return '____';
    if (type.isEntity) {
        switch (type.type) {
        case 'tt:email_address':
        case 'tt:phone_number':
        case 'tt:username':
        case 'tt:contact_name':
        case 'tt:contact':
            return _("someone");
        case 'tt:iso_lang_code':
            return _("some language");
        case 'sportradar:eu_soccer_team':
        case 'sportradar:us_soccer_team':
        case 'sportradar:mlb_team':
        case 'sportradar:nba_team':
        case 'sportradar:ncaafb_team':
        case 'sportradar:ncaambb_team':
            return _("some team");
        case 'tt:stock_id':
            return _("some company");
        default:
            return _("something");
        }
    } else if (type.isNumber) {
        return _("some number");
    } else if (type.isMeasure) {
        return _("some value");
    } else if (type.isDate) {
        return _("some date");
    } else if (type.isTime) {
        return _("some time");
    } else if (type.isLocation) {
        return _("some place");
    } else {
        return _("something");
    }
}

function describePrimitive(_, obj, primType, scope, applyHeuristics = false) {
    var kind = obj.selector.kind;
    var owner = obj.selector.principal;
    var channel = obj.channel;
    var schema = obj.schema;

    var confirm;
    if (kind === 'remote' || kind.startsWith('__dyn')) {
        // special case internal sending/receiving
        if (channel === 'send')
            confirm = _("send it to $__principal");
        else if (channel === 'receive')
            confirm = _("you receive something from $__principal");
        else
            throw TypeError('Invalid @remote channel ' + channel);
    } else if (owner) {
        confirm = schema.confirmation_remote;
        if (!confirm)
            confirm = schema.confirmation;
        if (confirm === schema.confirmation)
            confirm = confirm.replace('your', describeArg(_, owner, applyHeuristics) + '\'s').replace('you', describeArg(_, owner, applyHeuristics));
        else
            confirm = confirm.replace('$__person', describeArg(_, owner, applyHeuristics));
    } else {
        confirm = schema.confirmation;
        if (obj.selector.device)
            confirm = confirm.replace('$__device', obj.selector.device.name);
        else
            confirm = confirm.replace('$__device', clean(kind));
    }

    let firstExtra = true;
    for (let inParam of obj.in_params) {
        let argname = inParam.name;
        let ptype = obj.schema.inReq[argname] || obj.schema.inOpt[argname];
        let index = obj.schema.index[argname];
        let argcanonical = obj.schema.argcanonicals[index] || clean(argname);
        let value = inParam.value.isUndefined ? describePlaceholder(_, ptype, applyHeuristics) : describeArg(_, inParam.value, scope, applyHeuristics);
        if (confirm.indexOf('$' + argname) >= 0) {
            confirm = confirm.replace('$' + argname, value);
        } else {
            if (argname.startsWith('__'))
                continue;
            if (kind === 'remote' || kind.startsWith('__dyn'))
                continue;
            if (inParam.value.isUndefined)
                continue;
            if (firstExtra) {
                confirm = confirm + _(" with %s equal to %s").format(argcanonical, value);
                firstExtra = false;
            } else {
                confirm = confirm + _(" and %s equal to %s").format(argcanonical, value);
            }
        }
    }

    function describeFilter(expr) {
        if (expr.isTrue || (expr.isAnd && expr.operands.length === 0))
            return _("true");
        if (expr.isFalse || (expr.isOr && expr.operands.length === 0))
            return _("false");
        if ((expr.isAnd || expr.isOr) && expr.operands.length === 1)
            return describeFilter(expr.operands[0]);
        if (expr.isAnd)
            return expr.operands.map(describeFilter).reduce((x, y) => _("%s and %s").format(x, y));
        if (expr.isOr)
            return expr.operands.map(describeFilter).reduce((x, y) => _("%s or %s").format(x, y));
        if (expr.isNot)
            return _("not %s").format(describeFilter(expr.expr));

        let filter = expr.filter;
        let argname = filter.name;
        let argcanonical;
        if (argname in obj.schema.index) {
            let index = obj.schema.index[argname];
            argcanonical = obj.schema.argcanonicals[index] || clean(argname);
        } else {
            argcanonical = scope[argname];
        }
        let value =  describeArg(_, filter.value, scope, applyHeuristics);
        switch (filter.operator) {
        case 'contains':
        case 'substr':
        case '=~':
            return _("%s contains %s").format(argcanonical, value);
        case 'in_array':
        case '~=':
            return _("%s contains %s").format(value, argcanonical);
        case '=':
            return _("%s is equal to %s").format(argcanonical, value);
        case '!=':
            return _("%s is not equal to %s").format(argcanonical, value);
        case '<':
            return _("%s is less than %s").format(argcanonical, value);
        case '>':
            return _("%s is greater than %s").format(argcanonical, value);
        case '<=':
            return _("%s is less than or equal to %s").format(argcanonical, value);
        case '>=':
            return _("%s is greater than or equal to %s").format(argcanonical, value);
        default:
            throw new TypeError('Invalid operator ' + filter.operator);
        }
    }

    if (!obj.filter.isTrue) {
        if (primType === 'trigger')
            confirm = _("%s and %s").format(confirm, describeFilter(obj.filter));
        else if (primType === 'query')
            confirm = _("%s if %s").format(confirm, describeFilter(obj.filter));
    }

    for (let outParam of obj.out_params) {
        let argname = outParam.value;
        let index = obj.schema.index[argname];
        let argcanonical = obj.schema.argcanonicals[index] || clean(argname);
        scope[outParam.name] = argcanonical;
    }
    return confirm;
}

function describeRule(_, r) {
    let scope = {};
    let triggerIsTime = r.trigger && r.trigger.selector.kind === 'builtin';
    let triggerDesc = r.trigger ? describePrimitive(_, r.trigger, 'trigger', scope) : '';

    let queryDesc = r.queries.map((q) => describePrimitive(_, q, 'query', scope)).join(_(" and then "));
    let actions = r.actions.filter((a) => !a.selector.isBuiltin);
    let actionDesc = actions.map((a) => describePrimitive(_, a, 'action', scope)).join(_(" and "));

    let ruleDesc;
    if (actionDesc && queryDesc && triggerIsTime)
        ruleDesc = _("%s then %s %s").format(queryDesc, actionDesc, triggerDesc);
    else if (actionDesc && queryDesc && triggerDesc)
        ruleDesc = _("%s then %s when %s").format(queryDesc, actionDesc, triggerDesc);
    else if (actionDesc && triggerIsTime)
        ruleDesc = _("%s %s").format(actionDesc, triggerDesc);
    else if (actionDesc && triggerDesc)
        ruleDesc = _("%s when %s").format(actionDesc, triggerDesc);
    else if (queryDesc && triggerIsTime)
        ruleDesc = _("%s %s").format(queryDesc, triggerDesc);
    else if (queryDesc && triggerDesc)
        ruleDesc = _("%s when %s").format(queryDesc, triggerDesc);
    else if (actionDesc && queryDesc)
        ruleDesc = _("%s then %s").format(queryDesc, actionDesc);
    else if (triggerIsTime)
        ruleDesc = _("notify %s").format(triggerDesc);
    else if (triggerDesc)
        ruleDesc = _("notify when %s").format(triggerDesc);
    else if (queryDesc)
        ruleDesc = queryDesc;
    else if (actionDesc)
        ruleDesc = actionDesc;
    if (r.once)
        ruleDesc += _(" (only once)");
    return ruleDesc;
}

function describeProgram(_, program) {
    return program.rules.map((r) => describeRule(_, r)).join(', ');
}

function capitalize(str) {
    return (str[0].toUpperCase() + str.substr(1)).replace(/[\.\-_]([a-z])/g, function(whole, char) { return char.toUpperCase(); }).replace(/[\.\-_]/g, '');
}

function capitalizeSelector(prim) {
    let kind = prim.selector.kind;
    // thingengine.phone -> phone
    if (kind.startsWith('org.thingpedia.builtin.thingengine.'))
        kind = kind.substr('org.thingpedia.builtin.thingengine.'.length);
    // org.thingpedia.builtin.omlet -> omlet
    if (kind.startsWith('org.thingpedia.builtin.'))
        kind = kind.substr('org.thingpedia.builtin.'.length);
    // org.thingpedia.weather -> weather
    if (kind.startsWith('org.thingpedia.'))
        kind = kind.substr('org.thingpedia.'.length);
    // com.xkcd -> xkcd
    if (kind.startsWith('com.'))
        kind = kind.substr('com.'.length);
    if (kind.startsWith('gov.'))
        kind = kind.substr('gov.'.length);
    if (kind.startsWith('org.'))
        kind = kind.substr('org.'.length);

    let channel = prim.channel;
    if (kind === 'builtin')
        return capitalize(channel);
    else
        return capitalize(kind);
}

function getRuleName(_, r) {
    var triggerName = r.trigger ? capitalizeSelector(r.trigger) : '';

    var queryName = r.queries.map((q) => capitalizeSelector(q)).join(_(" to "));
    var actions = r.actions.filter((a) => !a.selector.isBuiltin);
    var actionName = actions.map((a) => capitalizeSelector(a)).join(_(" to "));
    if (actionName && queryName && triggerName)
        return _("%s to %s to %s").format(triggerName, queryName, actionName);
    else if (actionName && triggerName)
        return _("%s to %s").format(triggerName, actionName);
    else if (queryName && triggerName)
        return _("%s to %s").format(triggerName, queryName);
    else if (queryName && actionName)
        return _("%s to %s").format(queryName, actionName);
    else if (triggerName)
        return _("Monitor %s").format(triggerName);
    else if (actionName)
        return _("Execute %s").format(actionName);
    else
        return _("Query %s").format(queryName);
}

function getProgramName(_, program) {
    return program.rules.map((r) => getRuleName(_, r)).join(', ');
}

function pubDescribeArg(gettext, arg) {
    return describeArg(gettext.dgettext.bind(gettext, 'thingtalk'), arg);
}
function pubDescribeProgram(gettext, program) {
    return describeProgram(gettext.dgettext.bind(gettext, 'thingtalk'), program);
}
function pubGetProgramName(gettext, program) {
    return getProgramName(gettext.dgettext.bind(gettext, 'thingtalk'), program);
}
function pubDescribePrimitive(gettext, prim, primType, scope, applyHeuristics = false) {
    return describePrimitive(gettext.dgettext.bind(gettext, 'thingtalk'), prim, primType, scope, applyHeuristics);
}

module.exports = {
    describeArg: pubDescribeArg,
    describeProgram: pubDescribeProgram,
    describePrimitive: pubDescribePrimitive,
    getProgramName: pubGetProgramName
}