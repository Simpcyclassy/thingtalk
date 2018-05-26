// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2015-2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const Ast = require('./ast');
const Type = require('./type');
const Utils = require('./utils');
const Builtin = require('./builtin');

const ALLOWED_PRINCIPAL_TYPES = new Set([
    'tt:contact', 'tt:username'
]);

function log(message) {
    let debug = false;
    if (debug) console.log(message);
}

class Scope {
    constructor(scope) {
        this._globalScope = scope ? Object.assign({}, scope._globalScope) : {};
        this._scope = scope? Object.assign({}, scope._scope) : {};
        this._conflicts = scope? new Set(scope._conflicts) : new Set();
        this.$has_event = scope? scope.$has_event : false;
        this._inReq = scope? Object.assign({}, scope._inReq) : {};
        this._lambda_args = scope? Object.assign({}, scope._lambda_args) : {};
    }

    has(name) {
        return name in this._scope;
    }

    hasGlobal(name) {
        return name in this._globalScope;
    }

    hasInReq() {
        return Object.keys(this._inReq).length > 0;
    }

    getSchema(name) {
        if (this.hasGlobal(name))
            return this._globalScope[name];
        return null;
    }

    add(name, type) {
        // HACK FIXME
        //if (this.has(name))
        //    this._conflicts.add(name);
        this._scope[name] = type;
    }

    addGlobal(name, schema) {
        if (this.hasGlobal(name))
            throw new TypeError('Conflict on using ' + name);
        this._globalScope[name] = schema.clone();
    }

    addConflict(name) {
        this._conflicts.add(name);
    }

    popInReq(name, type) {
        this._inReq[name] = type;
    }
    removeInReq(name) {
        delete this._inReq[name];
    }

    clearInReq() {
        this._inReq = {};
    }

    initLambdaArgs(args) {
        this.assign(args);
        for (let name in args)
            this._lambda_args[name] = [];
    }

    isLambdaArg(arg) {
        return arg in this._lambda_args;
    }

    updateLambdaArgs(arg, name) {
        this._lambda_args[arg].push(name);
    }

    remove(name) {
        if (this._conflicts.has(name))
            delete this._conflicts[name];
        delete this._scope[name];
    }

    assign(name_type_pairs) {
        for (let name in name_type_pairs) {
            let type = name_type_pairs[name];
            if (type.isTable || type.isStream)
                this.addGlobal(name, Builtin.emptyFunction);
            else if (type.isFunctionDef)
                this.addGlobal(name, type);
            else
                this.add(name, type);
        }
    }

    merge(scope) {
        for (let name in scope._globalScope)
            this.add(name, scope.get(name));
        for (let name in scope._scope)
            this.add(name, scope.get(name));
        Object.assign(this._inReq, scope._inReq);
    }

    clean(args) {
        this._scope = {};
        this._conflicts = new Set();
        this.$has_event = false;
        this._inReq = {};
        this._lambda_args = {};
        if (args)
            Object.keys(args).forEach((name) => delete this._globalScope[name]);
    }

    prefix(prefix) {
        let new_scope = {};
        for (let name in this._scope)
            new_scope[prefix + '.' + name] = this._scope[name];
        this._scope = new_scope;
    }

    get(name) {
        if (this._conflicts.has(name))
            throw new TypeError('Conflicted field name ' + name + ' after join, cannot be used.');
        return this._globalScope[name] || this._scope[name];
    }

    dump() {
        console.log();
        console.log('Scope:');
        for (let name in this._scope)
            console.log(name  +': ' + this._scope[name]);
    }
}

function ensureSchema(schemas, classes, prim, primType, useMeta) {
    if (prim.schema)
        return Promise.resolve();

    if (prim.isVarRef) {
        return Utils.getMemorySchema(schemas, prim.name, useMeta).then((schema) => {
            if (schema === null)
                throw new TypeError('Cannot find table ' + prim.name + ' in memory');
            prim.schema = schema;
        });
    }
    if (prim.selector.isBuiltin && primType === 'action') {
        if (prim.channel === 'notify')
            prim.schema = Builtin.Actions.notify;
        else if (prim.channel === 'return')
            prim.schema = Builtin.Actions['return'];
        else if (prim.channel === 'save')
            prim.schema = Builtin.Actions['save'];
        else
            throw new TypeError('Invalid builtin action ' + prim.channel);
        return Promise.resolve();
    }
    if (prim.selector.isBuiltin)
        throw new TypeError('Invalid builtin ' + primType + ' ' + prim.channel);

    return Utils.getSchemaForSelector(schemas, prim.selector.kind, prim.channel, primType, useMeta, classes).then((schema) => {
        prim.schema = schema;
    });
}

function typeForValue(value, scope) {
    if (value.isVarRef) {
        let type;
        if (value.name.startsWith('$context.location'))
            type = Type.Location;
         else
            type = scope.get(value.name);

        if (!type)
            throw new TypeError('Variable ' + value.name + ' is not in scope');
        return type;
    }
    if (value.isEvent && value.name !== 'program_id' && !scope.$has_event)
        throw new TypeError('Cannot access $event variables in the trigger');
    return value.getType();
}

function resolveTypeVars(type, typeScope) {
    if (type === 'string')
        return resolveTypeVars(typeScope[type], typeScope);
    if (type.isArray)
        return Type.Array(resolveTypeVars(type.elem, typeScope));
    if (type.isTuple)
        return Type.Tuple(type.schema.map((t) => resolveTypeVars(t, typeScope)));
    if (type.isMeasure && typeScope._unit)
        return Type.Measure(typeScope._unit);
    return type;
}


function typecheckPrincipal(principal) {
    assert(principal.isEntity);
    if (!ALLOWED_PRINCIPAL_TYPES.has(principal.type))
        throw new TypeError(`Invalid principal ${principal}, must be a contact or a group`);
}

function resolveScalarExpressionOps(type_lhs, operator, type_rhs) {
    let op = Builtin.ScalarExpressionOps[operator];
    if (!op)
        throw new TypeError('Invalid operator ' + operator);
    for (let overload of op.types) {
        let typeScope = {};
        if (!Type.isAssignable(type_lhs, overload[0], typeScope, true))
            continue;
        if (!Type.isAssignable(type_rhs, overload[1], typeScope, true))
            continue;

        if (overload[2].isMeasure && typeScope['_unit'])
            return Type.Measure(typeScope['_unit']);
        return overload[2];
    }
    throw new TypeError(`Invalid parameter types ${type_lhs} and ${type_rhs} for ${operator}`);
}

function resolveScalarExpression(ast, schema, scope, schemas, classes, useMeta) {
    log('Type check scalar expression');
    if (ast.isBoolean) {
        typeCheckFilter(ast.value, schema, scope, schemas, classes, useMeta);
        return Type.Boolean;
    }
    if (ast.isPrimary) {
        if (ast.value.isVarRef) {
            let name = ast.value.name;
            let paramType = schema.inReq[name] || schema.inOpt[name] || schema.out[name] || scope.get(name);
            if (!paramType)
                throw new TypeError('Invalid parameter ' + name);
            return paramType;
        }
        return typeForValue(ast.value, scope);
    }
    if (ast.isDerived) {
        let operands = ast.operands.map((o) => resolveScalarExpression(o, schema, scope, schemas, classes, useMeta));
        return resolveScalarExpressionOps(operands[0], ast.op, operands[1]);
    }
    throw new TypeError(`Invalid scalar expression`);
}

function resolveFilterOverload(type_lhs, operator, type_rhs) {
    log('resolve filter overload');
    let op = Builtin.BinaryOps[operator];
    if (!op)
        throw new TypeError('Invalid operator ' + operator);
    if (type_lhs.isEntity && operator === '=~') {
        // using isAssignable will accept the operator (because it casts everything to String)
        // but we don't want that
        throw new TypeError(`Invalid parameter types ${type_lhs} and ${type_rhs} for ${operator}`);
    }
    for (let overload of op.types) {
        let typeScope = {};
        if (!Type.isAssignable(type_lhs, overload[0], typeScope, true))
            continue;
        if (!Type.isAssignable(type_rhs, overload[1], typeScope, true))
            continue;
        if (!Type.isAssignable(overload[2], Type.Boolean, typeScope, true))
            continue;
        return overload;
    }
    throw new TypeError(`Invalid parameter types ${type_lhs} and ${type_rhs} for ${operator}`);
}

function typeCheckFilter(ast, schema, scope, schemas, classes, useMeta) {
    log('Type check filter ...');
    return (function recursiveHelper(ast) {
        if (!ast)
            return Promise.resolve();
        if (ast.isTrue || ast.isFalse)
            return Promise.resolve();
        if (ast.isAnd || ast.isOr)
            return Promise.all(ast.operands.map((op) => recursiveHelper(op)));
        if (ast.isNot)
            return recursiveHelper(ast.expr);

        if (ast.isAtom) {
            let name = ast.name;
            let type_lhs = undefined;
            if (schema)
                type_lhs = schema.inReq[name] || schema.inOpt[name] || schema.out[name];
            if (!type_lhs)
                type_lhs = scope.get(name);
            if (!type_lhs)
                throw new TypeError('Invalid filter parameter ' + name);
            let type_rhs = typeForValue(ast.value, scope);
            ast.overload = resolveFilterOverload(type_lhs, ast.operator, type_rhs);
            if (ast.value.isVarRef && scope.isLambdaArg(ast.value.name))
                scope.updateLambdaArgs(ast.value.name, ast.name);

            return Promise.resolve();
        } else {
            assert(ast.isExternal);
            return ensureSchema(schemas, classes, ast, 'query', useMeta).then(() => {
                typeCheckInputArgs(ast, scope, classes);
                return typeCheckFilter(ast.filter, ast.schema, scope, schemas, classes, useMeta);
            });
        }
    })(ast);
}

function resolveAggregationOverload(ast, operator, field, schema) {
    let fieldType = schema.out[field];
    if (!fieldType)
        throw new TypeError('Invalid aggregation field ' + field);
    let ag = Builtin.Aggregations[operator];
    if (!ag)
        throw new TypeError('Invalid aggregation ' + operator);

    for (let overload of ag.types) {
        let typeScope = {};
        if (!Type.isAssignable(fieldType, overload[0], typeScope, true))
            continue;

        ast.overload = overload.map((t) => resolveTypeVars(t, typeScope));
        return ast.overload[1];
    }

    throw new TypeError('Invalid field type ' + fieldType + ' for ' + operator);
}

function cleanOutput(schema, scope) {
    let num_input = Object.keys(schema.inReq).length + Object.keys(schema.inOpt).length;
    schema.args = schema.args.slice(0, num_input);
    schema.types = schema.types.slice(0, num_input);
    for (let p in schema.index) {
        if (schema.index[p] >= num_input)
            delete schema.index[p];
    }
    for (let p in schema.out)
        scope.remove(p);

    schema.out = {};
}

function addOutput(schema, name, type, scope) {
    schema.args.push(name);
    schema.types.push(type);
    schema.index[name] = Object.keys(schema.index).length;
    schema.out[name] = type;
    scope.add(name, type);
}

function addInput(schema, name, type, required) {
    let num_input = Object.keys(schema.inReq).length + Object.keys(schema.inOpt).length;
    schema.args.splice(num_input, 0, name);
    schema.types.splice(num_input, 0, type);
    schema.index[name] = num_input;
    for (let p in schema.index) {
        if (p in schema.out)
            schema.index[p] = schema.index[p] + 1;
    }
    if (required)
        schema.inReq[name] = type;
    else
        schema.inOpt[name] = type;
}

function pushInReq(schema, scope) {
    if (scope.hasInReq()) {
        for (let name in scope._inReq)
            addInput(schema, name, scope._inReq[name], true);

        scope.clearInReq();
    }
}

function updateLambdaArgs(schema, scope, types) {
    for (let new_name in scope._lambda_args) {
        scope._lambda_args[new_name].forEach((old_name) => {
            if (new_name === old_name)
                return;
            schema.args[schema.index[old_name]] = new_name;
            schema.index[new_name] = schema.index[old_name];
            schema.inReq[new_name] = types[new_name];
            delete schema.index[old_name];
            delete schema.inReq[old_name];
            delete schema.inOpt[old_name];
        });
    }
}

function typeCheckAggregation(ast, scope) {
    let name, type;
    if (ast.field === '*') {
        if (ast.operator !== 'count')
            throw new TypeError('* is not a valid argument to ' + ast.operator);
        type = Type.Number;
        ast.overload = [Type.Any, type];
        name = ast.alias ? ast.alias : 'count';
    } else {
        type = resolveAggregationOverload(ast, ast.operator, ast.field, ast.schema);
        name = ast.alias ? ast.alias : ast.operator;
    }
    cleanOutput(ast.schema, scope);
    addOutput(ast.schema, name, type, scope);
    return Promise.resolve();
}

function typeCheckArgMinMax(ast) {
    let argm = Builtin.ArgMinMax[ast.operator];
    if (!argm)
        throw new TypeError('Invalid aggregation ' + ast.operator);
    let fieldType = ast.schema.out[ast.field];
    if (!fieldType)
        throw new TypeError('Invalid field ' + ast.field);

    if (Builtin.ArgMinMax[ast.operator].types.every((t) => !Type.isAssignable(fieldType, t)))
        throw new TypeError('Invalid ' + ast.operator + ' field ' + ast.field);
    if (!ast.base.isNumber || !ast.limit.isNumber)
        throw new TypeError('Invalid range for ' + ast.operator);
    return Promise.resolve();
}

function typeCheckComputation(ast, scope, schemas, classes, useMeta) {
    let name = ast.alias ? ast.alias : 'result';
    let type = resolveScalarExpression(ast.expression, ast.table.schema, scope, schemas, classes, useMeta);
    cleanOutput(ast.schema, scope);
    addOutput(ast.schema, name, type, scope);
    return Promise.resolve();
}

function typeCheckMonitor(ast) {
    if (ast.args) {
        ast.args.forEach((arg) => {
            if (!(arg in ast.schema.out))
                throw new TypeError('Invalid field name ' + arg);
        });
    }
    return Promise.resolve();
}

function resolveProjection(args, schema, scope) {
    args.forEach((arg) => {
        if (schema.args.indexOf(arg) === -1)
            throw new TypeError('Invalid field name ' + arg);
    });
    schema.args = args;
    schema.types = schema.args.map((arg) => schema.types[schema.index[arg]]);
    schema.index = schema.args.reduce((res, arg, i) => {
        res[arg] = i;
        return res;
    }, {});
    Object.keys(schema.out).forEach((arg) => {
        if (schema.args.indexOf(arg) === -1) {
            delete schema.out[arg];
            scope.remove(arg);
        }
    });
}

function resolveJoin(ast, lhs, rhs) {
    ast.schema = lhs.schema.clone();
    ast.schema.args = ast.schema.args.concat(rhs.schema.args);
    ast.schema.types = ast.schema.types.concat(rhs.schema.types);
    ast.schema.index = rhs.schema.args.reduce((res, arg) => {
        res[arg] = Object.keys(res).length;
        return res;
    }, lhs.schema.index);
    ast.schema.inReq = Object.assign({}, lhs.schema.inReq);
    ast.schema.inOpt = Object.assign({}, lhs.schema.inOpt);
    let in_params = Object.assign({}, ast.schema.inReq, ast.schema.inOpt);
    for (let p in rhs.schema.inReq) {
        if (p in in_params) {
            delete ast.schema.inReq[p];
            delete ast.schema.inOpt[p];
        } else {
            ast.schema.inReq[p] = rhs.schema.inReq[p];
        }
    }
    for (let p in rhs.schema.inOpt) {
        if (p in in_params) {
            delete ast.schema.inReq[p];
            delete ast.schema.inOpt[p];
        } else {
            ast.schema.inOpt[p] = rhs.schema.inOpt[p];
        }
    }
    ast.schema.out = Object.assign(ast.schema.out, rhs.schema.out);
}

function typeCheckInputArgs(ast, scope, classes, isDeclaration = false) {
    let schema = ast.schema;
    if (isDeclaration)
        pushInReq(schema, scope);
    if (!ast.isVarRef && !ast.isJoin) {
        if (ast.selector.kind in classes)
            ast.__effectiveSelector = Ast.Selector.Device(classes[ast.selector.kind].extends, ast.selector.id, ast.selector.principal);
        else
            ast.__effectiveSelector = ast.selector;
    }
    var presentParams = new Set;
    for (let inParam of ast.in_params) {
        let inParamType = schema.inReq[inParam.name] || schema.inOpt[inParam.name];
        if (!inParamType)
            throw new TypeError('Invalid input parameter ' + inParam.name);
        if (inParam.value.isEntity && inParam.value.type === 'tt:username' &&
            inParamType.isEntity && (inParamType.type === 'tt:phone_number' || inParamType.type === 'tt:email_address'))
            inParam.value.type = 'tt:contact_name';
        if (!Type.isAssignable(typeForValue(inParam.value, scope), inParamType, {}, true))
            throw new TypeError('Invalid type for parameter '+ inParam.name);
        if (presentParams.has(inParam.name))
            throw new TypeError('Duplicate input param ' + inParam.name);
        presentParams.add(inParam.name);
        if (inParam.value.isVarRef && scope.isLambdaArg(inParam.value.name))
            scope.updateLambdaArgs(inParam.value.name, inParam.name);
    }
    for (let inParam in schema.inReq) {
        if (!presentParams.has(inParam))
            scope.popInReq(inParam, schema.inReq[inParam]);
    }
}

function typeCheckInput(ast, schemas, scope, classes, useMeta = false, isDeclaration = false) {
    return ensureSchema(schemas, classes, ast, 'query', useMeta).then(() => {
        typeCheckInputArgs(ast, scope, classes, isDeclaration);
        return typeCheckFilter(ast.filter, ast.schema, scope, schemas, classes, useMeta);
    }).then(() => {
        if (ast.aggregation)
            return typeCheckAggregation(ast, scope);
        scope.assign(ast.schema.out);
        return Promise.resolve();
    });
}

function typeCheckOutput(ast, schemas, scope, classes, useMeta = false, isDeclaration = false) {
    log('Type check output ...');
    return ensureSchema(schemas, classes, ast, 'action', useMeta).then(() => {
        return typeCheckInputArgs(ast, scope, classes, isDeclaration);
    });
}

function typeCheckJoinInput(ast, schemas, scope, classes, useMeta) {
    typeCheckInputArgs(ast, scope, classes);
    return Promise.resolve(typeCheckFilter(ast.filter, ast.schema, scope, schemas, classes, useMeta)).then(() => {
        if (ast.aggregation)
            return typeCheckAggregation(ast, scope);
        scope.assign(ast.schema.out);
        return Promise.resolve();
    });
}

function typeCheckTable(ast, schemas, scope, classes, useMeta = false, isDeclaration = false) {
    log('Type check table ...');
    if (ast.isVarRef) {
        log('VarRef');
        if (scope.hasGlobal(ast.name))
            ast.schema = scope.getSchema(ast.name).clone();

        return ensureSchema(schemas, classes, ast, 'query', useMeta).then(() => {
            return typeCheckInput(ast, schemas, scope, classes, useMeta, isDeclaration);
        });
    }
    if (ast.isInvocation) {
        log('Invocation');
        return ensureSchema(schemas, classes, ast.invocation, 'query', useMeta).then(() => {
            ast.schema = ast.invocation.schema.clone();
            return typeCheckInput(ast.invocation, schemas, scope, classes, useMeta, isDeclaration);
        });
    }
    if (ast.isFilter) {
        log('Filter');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            return typeCheckFilter(ast.filter, ast.schema, scope, schemas, classes, useMeta);
        });
    }
    if (ast.isProjection) {
        log('Projection');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            resolveProjection(ast.args, ast.schema, scope);
            return Promise.resolve();
        });
    }
    if (ast.isAlias) {
        log('Alias');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            scope.addGlobal(ast.name, ast.schema);
            scope.prefix(ast.name);
            return Promise.resolve();
        });
    }
    if (ast.isAggregation) {
        log('Aggregation');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            return typeCheckAggregation(ast, scope);
        });
    }
    if (ast.isArgMinMax) {
        log('ArgMinMax');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            return typeCheckArgMinMax(ast);
        });
    }
    if (ast.isJoin) {
        log('Join');
        let leftscope = new Scope(scope);
        let rightscope = new Scope(scope);
        return Promise.resolve()
            .then(() => typeCheckTable(ast.lhs, schemas, leftscope, classes, useMeta, isDeclaration))
            .then(() => {
                return typeCheckTable(ast.rhs, schemas, rightscope, classes, useMeta, isDeclaration);
            }).then(() => {
                resolveJoin(ast, ast.lhs, ast.rhs);
                leftscope.$has_event = true;
                for (let inParam of ast.in_params)
                    rightscope.removeInReq(inParam.name, leftscope.get(inParam.value.name));
                return typeCheckJoinInput(ast, schemas, leftscope, classes, useMeta);
            }).then(() => {
                scope.merge(leftscope);
                scope.merge(rightscope);
            });
    }
    if (ast.isWindow || ast.isTimeSeries) {
        log('Window or TimeSeries');
        if (ast.isWindow && (!typeForValue(ast.base, scope).isNumber || !typeForValue(ast.delta, scope).isNumber))
            throw new TypeError('Invalid range for window');
        if (ast.isTimeSeries && (!typeForValue(ast.base, scope).isDate
                || !typeForValue(ast.delta, scope).isMeasure
                || typeForValue(ast.delta, scope).unit !== 'ms'))
            throw new TypeError('Invalid time range');
        return typeCheckStream(ast.stream, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.stream.schema.clone();
            return Promise.resolve();
        });
    }
    if (ast.isSequence || ast.isHistory) {
        log('Sequence or History');
        if (ast.isSequence && (!typeForValue(ast.base, scope).isNumber || !typeForValue(ast.delta, scope).isNumber))
            throw new TypeError('Invalid range for window');
        if (ast.isHistory && (!typeForValue(ast.base, scope).isDate
                || !typeForValue(ast.delta, scope).isMeasure
                || typeForValue(ast.delta, scope).unit !== 'ms'))
            throw new TypeError('Invalid time range');
        return typeCheckStream(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            return Promise.resolve();
        });
    }
    if (ast.isCompute) {
        log('Compute');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            return typeCheckComputation(ast, scope, schemas, classes, useMeta);
        });
    }
    throw new Error('Not Implemented');
}

function typeCheckStream(ast, schemas, scope, classes, useMeta = false, isDeclaration = false) {
    log('Type check stream ...');
    if (ast.isVarRef) {
        if (scope.hasGlobal(ast.name))
            ast.schema = scope.getSchema(ast.name).clone();

        return ensureSchema(schemas, classes, ast, 'query', useMeta).then(() => {
            return typeCheckInput(ast, schemas, scope, classes, useMeta, isDeclaration);
        });
    }
    if (ast.isTimer || ast.isAtTimer) {
        ast.schema = Builtin.emptyFunction;
        return Promise.resolve();
    }
    if (ast.isMonitor) {
        log('Monitor');
        return typeCheckTable(ast.table, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.table.schema.clone();
            return typeCheckMonitor(ast);
        });
    }
    if (ast.isEdgeNew) {
        return typeCheckStream(ast.stream, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.stream.schema.clone();
            return Promise.resolve();
        });
    }
    if (ast.isEdgeFilter) {
        return typeCheckStream(ast.stream, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.stream.schema.clone();
            return typeCheckFilter(ast.filter, ast.schema, scope, schemas, classes, useMeta);
        });
    }
    if (ast.isFilter) {
        log('Filter');
        return typeCheckStream(ast.stream, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.stream.schema.clone();
            return typeCheckFilter(ast.filter, ast.schema, scope, schemas, classes, useMeta);
        });
    }
    if (ast.isAlias) {
        return typeCheckStream(ast.stream, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.stream.schema.clone();
            scope.addGlobal(ast.name, ast.schema);
            scope.prefix(ast.name);
            return Promise.resolve();
        });
    }
    if (ast.isProjection) {
        log('Projection');
        return typeCheckStream(ast.stream, schemas, scope, classes, useMeta, isDeclaration).then(() => {
            ast.schema = ast.stream.schema.clone();
            resolveProjection(ast.args, ast.schema, scope);
            return Promise.resolve();
        });
    }
    if (ast.isJoin) {
        log('Join');
        let leftscope = new Scope(scope);
        let rightscope = new Scope(scope);
        return Promise.resolve()
            .then(() => typeCheckStream(ast.stream, schemas, leftscope, classes, useMeta, isDeclaration))
            .then(() => {
                return typeCheckTable(ast.table, schemas, rightscope, classes, useMeta, isDeclaration);
            }).then(() => {
                resolveJoin(ast, ast.stream, ast.table);
                leftscope.$has_event = true;
                for (let inParam of ast.in_params)
                    rightscope.removeInReq(inParam.name, leftscope.get(inParam.value.name));
                return typeCheckJoinInput(ast, schemas, leftscope, classes, useMeta);
            }).then(() => {
                scope.merge(leftscope);
                scope.merge(rightscope);
            });
    }
    throw new Error('Not Implemented');
}

function typeCheckDeclaration(ast, schemas, scope, classes, useMeta) {
    return Promise.resolve().then(() => {
        switch (ast.type) {
            case 'stream':
                scope.initLambdaArgs(ast.args);
                return typeCheckStream(ast.value, schemas, scope, classes, useMeta, true).then(() => {
                    let schema = ast.value.schema.clone();
                    updateLambdaArgs(schema, scope, ast.args);
                    scope.clean(ast.args);
                    scope.addGlobal(ast.name, schema);
                    return Promise.resolve();
                });
            case 'table':
                scope.initLambdaArgs(ast.args);
                return typeCheckTable(ast.value, schemas, scope, classes, useMeta, true).then(() => {
                    let schema = ast.value.schema.clone();
                    updateLambdaArgs(schema, scope, ast.args);
                    scope.clean(ast.args);
                    scope.addGlobal(ast.name, schema);
                    return Promise.resolve();
                });
            case 'action':
                scope.initLambdaArgs(ast.args);
                return typeCheckOutput(ast.value, schemas, scope, classes, useMeta, true).then(() => {
                    let schema = ast.value.schema.clone();
                    updateLambdaArgs(schema, scope, ast.args);
                    scope.clean(ast.args);
                    scope.addGlobal(ast.name, schema);
                    return Promise.resolve();
                });
            default:
                throw new TypeError(`Invalid declaration type ${ast.type}`);
        }
    });
}

function addRequiredInputParams(prim, scope) {
    let present = new Set;
    for (let in_param of prim.in_params)
        present.add(in_param.name);

    for (let name in prim.schema.inReq) {
        if (!present.has(name) && name in scope._inReq)
            prim.in_params.push(Ast.InputParam(name, Ast.Value.Undefined(true)));
    }
}

function typeCheckRule(ast, schemas, scope, classes, useMeta = false) {
    log('Type check rule ...');
    return Promise.resolve().then(() => {
        if (ast.table !== undefined && ast.table !== null)
            return typeCheckTable(ast.table, schemas, scope, classes, useMeta);
        else if (ast.stream !== undefined && ast.stream !== null)
            return typeCheckStream(ast.stream, schemas, scope, classes, useMeta);
        else
            return null;
    }).then((event) => {
        if (event !== null)
            scope.$has_event = true;
        if (ast.isRule) {
            for (let [,prim] of ast.stream.iteratePrimitives())
                addRequiredInputParams(prim, scope);
        } else if (ast.table) {
            for (let [,prim] of ast.table.iteratePrimitives())
                addRequiredInputParams(prim, scope);
        }

        if (ast.actions.some((a) => a.selector.isBuiltin) && !ast.stream && !ast.table)
            throw new TypeError('Cannot return a result without a GET function');
    }).then(() => Promise.all(
        ast.actions.map((action) => typeCheckOutput(action, schemas, scope, classes, useMeta)))
    ).then(() => {
        for (let prim of ast.actions)
            addRequiredInputParams(prim, scope);
    });
}

function typeCheckProgram(ast, schemas, useMeta = false) {
    const classes = {};
    ast.classes.forEach((ast) => {
        classes[ast.name] = ast;
    });
    const scope = new Scope();
    if (ast.principal !== null)
        typecheckPrincipal(ast.principal);

    function declLoop(i) {
        if (i === ast.declarations.length)
            return Promise.resolve();
        scope.clean();
        return typeCheckDeclaration(ast.declarations[i], schemas, scope, classes, useMeta).then(() => declLoop(i+1));
    }
    function ruleLoop(i) {
        if (i === ast.rules.length)
            return Promise.resolve();
        scope.clean();
        return typeCheckRule(ast.rules[i], schemas, scope, classes, useMeta).then(() => ruleLoop(i+1));
    }

    return Promise.resolve().then(() => declLoop(0)).then(() => ruleLoop(0));
}

function getAllowedSchema(allowed, schemaType, schemas, getMeta) {
    if (!allowed.isSpecified)
        return Promise.resolve();
    if (allowed.schema) {
        return Promise.resolve(allowed.schema);
    } else {
        return Utils.getSchemaForSelector(schemas, allowed.kind, allowed.channel, schemaType, getMeta, {})
            .then((schema) => {
                allowed.schema = schema;
                return schema;
            });
    }
}

function typeCheckPermissionRule(permissionRule, schemas, getMeta = false) {
    return Promise.all([
        getAllowedSchema(permissionRule.query, 'queries', schemas, getMeta),
        getAllowedSchema(permissionRule.action, 'actions', schemas, getMeta)
    ]).then(() => {
        const scope = new Scope();
        scope.add('source', Type.Entity('tt:contact'));
        return typeCheckFilter(permissionRule.principal, null, scope, schemas, {}, getMeta);
    }).then(() => {
        const scope = new Scope();
        function typecheckPermissionFunction(fn) {
            if (!fn.isSpecified)
                return Promise.resolve();

            return typeCheckFilter(fn.filter, fn.schema, scope, schemas, {}, getMeta).then(() => {
                for (let name in fn.schema.out)
                    scope.add(name, fn.schema.out[name]);
            });
        }
        return typecheckPermissionFunction(permissionRule.query).then(() => {
            scope.$has_event = true;
            return typecheckPermissionFunction(permissionRule.action);
        });
    });
}

module.exports = {
    typeCheckInput,
    typeCheckOutput,
    typeCheckRule,
    typeCheckTable,
    typeCheckStream,
    typeCheckProgram,
    typeCheckFilter,
    typeCheckPermissionRule
};