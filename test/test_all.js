// all tests, in batch form
"use strict";

const Q = require('q');
Q.longStackSupport = true;
process.on('unhandledRejection', (up) => { throw up; });

process.env.TEST_MODE = '1';

require('./test_units');
require('./test_date_utils');
require('./test_builtin_values');
require('./test_ast');
require('./test_generated_parser');
require('./app_grammar_test');
require('./test_typecheck');
require('./test_nn_syntax');
require('./test_compiler');
require('./test_builtin');
require('./test_describe');
require('./test_describe_policy');
require('./test_permissions');
require('./test_lowerings');
require('./test_declaration_program');
require('./test_convert_program_to_policy');
require('./test_iteration_apis');
//require('./test_sql_compiler');
