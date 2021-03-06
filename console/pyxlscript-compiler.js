/* By Morgan McGuire @CasualEffects http://casual-effects.com GPL 3.0 License */
"use strict";

function makeError(msg, srcLine) {
    return {lineNumber: (srcLine + 1), message: msg};
}

String.prototype.rtrim = function() {
    return this.replace(/\s+$/, '');
}

/** Assumes that str[i]=='('. Returns the index of the
    matching close ')', assuming that parens are balanced
    and there are no quoted strings or incorrectly
    nested other grouping characters. */
function findMatchingParen(str, i, direction) {
    i += direction;
    for (let stack = 1; stack > 0; i += direction) {
        switch (str[i]) {
        case '(': stack += direction; break;
        case ')': stack -= direction; break;
        }
        if (i === str.length || i === -1) {
            throw 'Missing matching parenthesis';
        }
    } // for
    
    return i;
}


/** Returns the index of c or d within str on or after j, or -1 if none.
    Skips over balanced ()[]{}. */
function nextInstance(str, c, j, d) {
    if (d !== undefined) {
        // Two arguments; see which comes first
        const i0 = nextInstance(str, c, j);
        const i1 = nextInstance(str, d, j);
        if (i0 > -1) {
            if (i1 > -1) {
                return Math.min(i0, i1);
            } else {
                return i0;
            }
        } else {
            return i1;
        }
    }

    j = j || 0;
    
    const count = {'(': 0, '{':0, '[':0};
    const match = {')': '(', '}':'{', ']':'['};
    let stack = 0;
    while (j < str.length) {
        const x = str[j];
        if (x in count) {
            ++count[x];
            ++stack;
        } else if (x in match) {
            --stack;
            if (--count[match[x]] < 0) {
                console.log(str);
                throw "Unbalanced parens while looking for '" + c + "'";
            }
        } else if ((x === c) && (stack === 0)) {
            return j;
        }
        ++j;
    }

    return -1;
}


/** Given a pyxl WITH preamble not surrounded in extra (), returns an
    array of two elements: [0] is the code that goes at the front of
    the block, and [1] is the code that goes at the end.  */
function processWithHeader(test) {
    // Cannot create a function because that would break the coroutines used for preemptive
    // multitasking
    //
    // Syntax: with var0[, var1[, ...]] ∊ expr
    //
    //
    // Maps to (__ variables are gensyms):
    //
    //
    // { let __obj = (expr),
    //       var0 = __obj.var0, ..., varn = __obj.varn,
    //       __var0Descriptor = Object.getOwnPropertyDescriptor(__obj, 'var0'), ...;
    //   Object.defineProperties(__obj, {var0: {configurable:true, get() { return var0; }, set(__v) { var0 = __v; }}, ...});
    //   try {
    //
    //      ...
    //
    //   } finally {
    //       if (__var0Descriptor.get) Object.defineProperty(__obj, 'var0', __var0Descriptor); else delete __obj.var0; __obj.var0 = var0;
    //       ...
    //  }}

    const match = test.match(withIdentifierListRegex);
    // match[0] = whole match
    // match[1] = variables
    // match[2] = object expression

    if (! match) {
        throw 'Incorrect WITH statement syntax';        
    }
    
    const expr = match[2].trim();
    const varArray = match[1].split(',').map(function (s) { return s.trim(); });

    const obj = gensym('obj'), v = gensym('v');
    const varDescriptorArray = varArray.map(function (vari) { return gensym(vari + 'Descriptor'); });

    const result = [];
    result[0] = `{ let ${obj} = (${expr})`;
    for (let i = 0; i < varArray.length; ++i) {
        result[0] += `, ${varArray[i]} = ${obj}.${varArray[i]}`;
    }
    
    for (let i = 0; i < varArray.length; ++i) {
        result[0] += `, ${varDescriptorArray[i]} = _Object.getOwnPropertyDescriptor(${obj}, '${varArray[i]}')`;
    }
    
    result[0] += `; _Object.defineProperties(${obj}, {` +
        varArray.reduce(function(prev, vari) { return prev + `${vari}: {configurable: true, get() { return ${vari}; }, set(${v}) { ${vari} = ${v}; }}, `; }, '') +
        '}); try {';
    

    result[1] = '} finally { ';

    for (let i = 0; i < varArray.length; ++i) {
        result[1] += `if (${varDescriptorArray[i]}.get) _Object.defineProperty(${obj}, '${varArray[i]}', ${varDescriptorArray[i]}); else delete ${obj}.${varArray[i]}; ${obj}.${varArray[i]} = ${varArray[i]}; `;
    }
    result[1] += '}}';
    
    return result;
}


/** Given a pyxl FOR-loop test that does not contain the colon,
 * returns the parts before and after the loop. */
function processForTest(test) {
    let before = '', after = '}';

    if ((test[0] === '(') && (test[test.length - 1] === ')') && (nextInstance(test, ')', 1) === test.length - 1)) {
        // There are extra parens surrounding the entire test
        test = test.substring(1, test.length - 1);
    }

    // The case of a FOR-WITH loop of the form 'for x,y,... ∊ a ∊ array ...'
    let match = test.match(RegExp('^\\s*(\\S.*)∊\\s*(' + identifierPattern + ')\\s*∊(.*)$'));
    if (match) {
        // match[1] = member variables
        // match[2] = with container expr/for variable
        // match[3] = for container expr

        // Rewrite the tested expr
        let withPart = processWithHeader(match[1] + '∊' + match[2]);
        before = withPart[0];
        after = withPart[1] + '}';
        test = match[2] + '∊' + match[3]
    }
        
    match = test.match(RegExp('^\\s*(' + identifierPattern + ')\\s*∊(.*)$'));
    
    if (match) {
        // Generate variables
        let container = gensym('cntnr'), keys = gensym('keys'), index = gensym('index'),
            cur = match[1], containerExpr = match[2].trim(), tmp = gensym('tmp'), N = gensym('N');

        return [`for (let ${tmp} = ${containerExpr}, ${container} = isObject(${tmp}) ? _Object.keys(${tmp}) : _clone(${tmp}), ${N} = ${container}.length, ` +
                `${index} = 0; ${index} < ${N}; ++${index}) { let ${cur} = ${container}[${index}]; ${before} ` , after];
    } else {
        before = '{';
    }

    // Range FOR loop
    
    // Look for ≤ or < expressions, but skip over pairs of parens
    const j = nextInstance(test, '<', 0, '≤');
    if (j === -1) { throw 'No < or ≤ found in FOR loop declaration'; }
    var op = (test[j] === '≤') ? '<=' : '<';
    
    const k = nextInstance(test, '<', j + 1, '≤');
    let identifier, initExpr, endExpr;

    if (k === -1) {
        // has the form "variable < expr"
        identifier = test.substring(0, j).trim();
        endExpr = test.substring(j + 1).trim();
        initExpr = '0';
    } else {
        // has the form "expr < variable < expr"
        // j is the location of the first operator
        // k is the location of the second operator
        
        initExpr = test.substring(0, j).trim();
        if (op === '<') {
            initExpr = '_Math.floor(' + initExpr + ') + 1';
        }

        op = (test[k] === '≤') ? '<=' : '<';
        identifier = test.substring(j + 1, k).trim();
        endExpr = test.substring(k + 1).trim();
    }

    if (! legalIdentifier(identifier)) { throw 'Illegal FOR-loop variable syntax'; }
    const iterator = gensym(identifier);
    return [`for (let ${iterator} = ${initExpr}; ${iterator} ${op} ${endExpr}; ++${iterator}) ${before} let ${identifier} = ${iterator};`, after];
}


/**
   Returns the line after compilation to JavaScript.

   Algorithm:
   1. Process the line up to the first ';' or single-line block body
   2. Process the rest recursively
*/
function processLine(line, inFunction) {
    let next = '';
    let separatorIndex = line.indexOf(';')
    if (separatorIndex > 0) {
        // Separate the next statement out
        next = line.substring(separatorIndex + 1).trim();
        line = line.substring(0, separatorIndex).rtrim();
    } else {
        line = line.rtrim();
    }

    if (line.search(/\S/) < 0) {
        // Empty line, we're done
        return line;
    }

    let match;
    if (match = line.match(/^(\s*)(for|if|(?:else[ \t]+if)|else|while|until|with|def|local)(\b.*)/)) {
        // line is a control flow-affecting expresion
        let before = match[1], type = match[2], rest = match[3].trim() + '; ' + next;

        if ((type === 'function') || (type === 'def')) {
            match = rest.match(/\s*([^\( \n\t]+)?\s*\((.*?)\)[ \t]*:(.*)/);

            if (! match) { throw 'Ill-formed single-line function definition'; }
            let name = match[1];
            let args = match[2] || '';
            let body = match[3];

            body = processLine(body, true);
            // Wrapping the function definition in parens can trigger heuristics in Chromium
            // at top level that improve compilation (likely not useful for dynamically generated code, but potentially
            // helpful when exporting to static HTML)
            line = before + 'const ' + name + ' = (function(' + args + ') { ' + maybeYieldFunction + body + ' })';
            return line;

        } else {
            
            // Read the test expression
            let end = nextInstance(rest, ':');
            if (end === -1) { throw 'Missing : after single-line "' + type + '".'; }
            let test = rest.substring(0, end);
            let prefix = '', suffix = '}';

            switch (type) {
            case 'local':
                type = '';
                prefix = '{';
                break;

            case 'with':
                {
                    const result = processWithHeader(test);
                    prefix = result[0];
                    suffix = result[1];
                }
                break;

            case 'until':
                type = 'while';
                prefix = 'while (! (' + test + ')) {';
                break;

            case 'for':
                {
                    const result = processForTest(test);
                    prefix = result[0];
                    suffix = result[1];
                }
                break;

            case 'else':
                prefix = type + ' {';
                break;
                
            default:
                // case 'while':
                // case 'if':
                // case /else[ \t]+if/:
                prefix = type + ' (' + test.trim() + ') {';
                break;
            }
            return before + prefix + ((type === 'while' || type === 'for') ? (inFunction ? maybeYieldFunction : maybeYieldGlobal) : '') +
                processLine(rest.substring(end + 1), inFunction) + '; ' + suffix;
            
        } // if control flow block
    } else if (match = line.match(/^(\s*)(preservingTransform\s*:)(.*)/)) {
        // line is a control flow-affecting expresion
        let before = match[1], type = match[2], rest = match[3].trim() + '; ' + next;

        let end = nextInstance(rest, ':');
        if (end === -1) { throw 'Missing : after single-line "' + type + '".'; }

        return before + 'try { _pushGraphicsState(); ' +
            processLine(rest.substring(end + 1), inFunction) + '; } finally { _popGraphicsState(); }';
    
    } else if (match = line.match(/^(\s*)(let|const)\s+(.*)/)) {

        // match let or const
        let before = match[1];
        let type   = match[2];
        let rest   = match[3];

        if ((type === 'let') || (type === 'const')) {
            return before + type + ' ' + rest + ((next !== '') ? '; ' + processLine(next, inFunction) : ';');
        }

    } else if (match = line.match(/^(\s*)(debugWatch)\s*(\(.+)/)) {
        let before = match[1];
        let rest = match[3];
        let closeIndex = findMatchingParen(rest, 0, +1);

        let watchExpr = rest.substring(1, closeIndex - 1);
        return before + '(_debugWatchEnabled && _debugWatch("' + watchExpr.replace(/"/g, '\"') + '", ' + watchExpr + ')); ' + processLine(rest.substring(closeIndex + 1), inFunction);
        
    } else {
        // Recursively process the next expression. 
        return line + '; ' + processLine(next, inFunction);
    }
}


/**
 returns nextLineIndex

 Mutate the lines in place
 
 1. Iteratively process lines in the current block, using processLine on each
 2. Recursively process sub-blocks
*/
function processBlock(lineArray, startLineIndex, inFunction, internalMode) {
    // Indentation of the previous block. Only used for indentation error checking
    let prevBlockIndent = 0;
    
    // indentation index of the previous line, indentation index of the block start
    let prevIndent, originalIndent;

    if (startLineIndex > 0) {
        // There MUST be some valid code on the previous line, since otherwise
        // processBlock would not have been invoked
        prevBlockIndent = lineArray[startLineIndex - 1].search(/\S/);
    }
    
    // current line index
    let i;
    for (i = startLineIndex; i < lineArray.length; ++i) {
        // trim right whitespace
        lineArray[i] = lineArray[i].rtrim();
        let indent = lineArray[i].search(/\S/);
        // Ignore empty lines
        if (indent < 0) { continue; }

        if (prevIndent === undefined) {
            // initialize on the first non-empty line
            prevIndent = indent;
            originalIndent = indent;
        }

        // Has the block ended?
        if (indent < originalIndent) {
            // Indentation must not be more than the previous block
            // or that would indicate inconsistent indentation
            if (indent > prevBlockIndent) {
                throw makeError('Inconsistent indentation', i);
            }
            return i;
        }
        
        ///////////////////////////////////////////////////////////////////////
        // Check for some illegal situations while we're processing

        // Colors in hex format
        lineArray[i] = lineArray[i].replace(/#([0-9a-fA-F]+)/g, function (match, str) {
            const color = parseHexColor(str);
           
            if (str.length === 3 || str.length === 1 || str.length === 6) {
                if ((color.r === color.g) && (color.g === color.b)) {
                    return `gray(${color.r})`;
                } else {
                    return `rgb(${color.r}, ${color.g}, ${color.b})`;
                }
            } else {
                return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
            }
        });

        if (/[^A-Za-zαβγΔδζηθιλμρσϕφχψτωΩ_\.0-9#]0\d/g.test(lineArray[i])) {
            throw makeError('Numbers may not begin with a leading zero', i);
        }

        if (lineArray[i].indexOf('%') !== -1) {
            throw makeError('% may only appear at the end of a number (did you intend to use the "mod" operator?)', i);
        }
        
        const illegal = lineArray[i].match(/\b(===|!==|toString|try|switch|this|delete|null|arguments|undefined|use|using|yield|prototype|var|new|auto|as|instanceof|typeof|\$|class)\b/) ||
              lineArray[i].match(/('|!(?!=))/) ||
              (! internalMode && lineArray[i].match(/\b_.*?\b/));
        
        if (illegal) {
            const alternative = {"'":'"', '!==':'!=', '!':'not', 'var':'let', 'null':'nil', '===':'=='};
            let msg = 'Illegal symbol "' + illegal[0] + '"';
            if (illegal[0] in alternative) {
                msg += ' (maybe you meant "' + alternative[illegal[0]] + '")';
            }

            if (illegal[0] === "'") {
                msg = 'Illegal single-quote (\'). Maybe you meant to use double quote (") for a string.';
            }
            
            throw makeError(msg, i);
        }

        if ((i === 0) && (indent > 0)) {
            throw makeError('First line must not be indented', i);
        }

        ///////////////////////////////////////////////////////////////////////

        // See if the next non-empty line is not indented more than this one
        let singleLine = true;
        for (let j = i + 1; j < lineArray.length; ++j) {
            let nextIndent = lineArray[j].search(/\S/);
            if (nextIndent >= 0) {
                singleLine = (nextIndent <= indent);
                break;
            }
        }

        // Note the assignment to variable `match` in the IF statement tests below
        let match;
        if (singleLine) {
            try {
                lineArray[i] = processLine(lineArray[i], inFunction);
            } catch (e) {
                throw makeError(e, i);
            }
            
        } else if (match = lineArray[i].match(RegExp('^(\\s*)def\\s+(' + identifierPattern + ')\\s*\\(([^\\)]*)\\)[ \t]*:'))) {
            // DEF
            
            let prefix = match[1], name = match[2], args = match[3] || '';
            let end = processBlock(lineArray, i + 1, true, internalMode) - 1;
            lineArray[i] = prefix + 'const ' + name + ' = (function(' + args + ') { ' + maybeYieldFunction;
            i = end;
            lineArray[i] += '});';
            
        } else if (match = lineArray[i].match(/^(\s*)with\s+\(?(.+∊.+)\)?[ \t]*:[ \t]*$/)) {
            // WITH
            
            let prefix = match[1];
            let result;
            try {
                result = processWithHeader(match[2]);
            } catch (e) {
                throw makeError(e, i);
            }
            lineArray[i] = prefix + result[0];
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += result[1];

        } else if (match = lineArray[i].match(/^(\s*)local[ \t]*:[ \t]*$/)) {
            // LOCAL
            
            let prefix = match[1];
            lineArray[i] = prefix + '{';
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += '}';

        } else if (match = lineArray[i].match(/^(\s*)preservingTransform[ \t]*:[ \t]*$/)) {
            // PRESERVING TRANSFORM
            
            let prefix = match[1];
            lineArray[i] = prefix + 'try { _pushGraphicsState()';
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += '} finally { _popGraphicsState(); }';

        } else if (match = lineArray[i].match(/^(\s*)for\s*(\b[^:]+)[ \t]*:[ \t]*$/)) {
            // FOR
            let prefix = match[1];
            let test = match[2];
            let forPart;
            try {
                forPart = processForTest(test);
            } catch (e) {
                throw makeError(e, i);
            }
            lineArray[i] = prefix + forPart[0] + (inFunction ? maybeYieldFunction : maybeYieldGlobal);
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += forPart[1];
            
        } else if (match = lineArray[i].match(/^(\s*)(if|else[\t ]+if)(\b.*):\s*$/)) {
            // IF, ELSE IF

            let old = i;
            lineArray[i] = match[1] + (/^\s*else[\t ]+if/.test(match[2]) ? 'else ' : '') + 'if (' + match[3].trim() + ') {';
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += '}';
            
        } else if (match = lineArray[i].match(/^(\s*else)\s*:\s*$/)) {
            // ELSE
            
            lineArray[i] = match[1] + ' {';
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += '}';
            
        } else if (match = lineArray[i].match(/^(\s*)(while|until)(\b.*)\s*:\s*$/)) {
            // WHILE/UNTIL
            
            let test = match[3];
            if (match[2] === 'until') {
                test = '! (' + test + ')';
            }

            lineArray[i] = match[1] + 'while (' + test + ') { ' + (inFunction ? maybeYieldFunction : maybeYieldGlobal);
            i = processBlock(lineArray, i + 1, inFunction, internalMode) - 1;
            lineArray[i] += '}';

        } else {
            throw makeError('Illegal block statement', i);
        }

        prevIndent = indent;
    } // for each line
    
    return i;
}

// The identifier pattern is also used in quadplay-runtime.js _removeMarkup() and must be kept in sync
const identifierPattern = '[Δ]?(?:[A-Za-z][A-Za-z_0-9]*|[αβγΔδζηθιλμρσϕφχψτωΩ][_0-9]*(?:_[A-Za-z_0-9]*)?)';
const identifierRegex = RegExp(identifierPattern);

// for WITH statements
const withIdentifierListRegex = RegExp('^[ \\t]*(' + identifierPattern + '[ \\t]*(?:,[ \\t]*' + identifierPattern + '[ \\t]*)*)∊(.*)$');


function legalIdentifier(id) {
    return id.match(identifierRegex);
}


/** Magnitude and absolute value */
function processBars(src, sym, fcn) {
    // Absolute value
    var i = src.indexOf(sym);
    while (i >= 0) {
        let j = nextInstance(src, sym, i + 1);
        if (j === -1) { throw makeError("Unbalanced " + sym + "..." + sym, 0); }
        src = src.substring(0, i) + ' ' + fcn + '(' + src.substring(i + 1, j) + ') ' + src.substring(j + 1);

        // See if there are more instances
        i = src.indexOf(sym);
    }
    return src;
}


let gensymNum = 0;
/** Returns a new identifier */
function gensym(base) {
    return '__' + (base || '') + (++gensymNum) + '__';
}

/** Expression for selective yields to avoid slowing down tight loops */
var maybeYieldGlobal = ' {if (!(__yieldCounter = (__yieldCounter + 1) & 8191)) { yield; }} ';

/** Expression for 'yield' inside a function, where regular yield is not allowed */
var maybeYieldFunction = '';

const unprotectQuotedStrings = BetterJSON.unprotectQuotedStrings;
const protectQuotedStrings = BetterJSON.protectQuotedStrings;

/** Pull up multi-line expressions enclosed in (), [], {} onto their
    start line and leave the intervening lines empty. This undesirably
    gives incorrect line numbers for errors within those expressions,
    but it allows the rest of the parser to operate strictly on single-line
    expressions and control flow. 


    Also compact lines that terminate in a ",", which can result from a multiline
    FOR or WITH statement
*/
function compactMultilineLiterals(lineArray) {
    let i = 0;

    // Count across the current multi-line expression
    let count = Object.seal([0, 0, 0]);

    const BRACKET  = '()[]{}';

    while (i < lineArray.length) {
        // -1 when there is no current expression building
        let currentExprStartLine = -1;
        let multiLine = false;
        do {
            const line = lineArray[i];

            // Update the count for this line
            for (let j = 0; j < line.length; ++j) {
                let type = BRACKET.indexOf(line[j]);
                if (type > -1) {
                    // even indices are open brackets that increment,
                    // odds indices are close brackets that decrement.
                    count[type >> 1] += 1 - ((type & 1) << 1);
                }
            }

            // See if we're still unbalanced
            multiLine = false;
            for (let c = 0; c < 3; ++c) {
                if (count[c] < 0) {
                    throw makeError('Extra "' + BRACKET[2 * c + 1] + '", no expression to close', i);
                } else if (count[c] > 0) {
                    if (currentExprStartLine === -1) {
                        // Start a new expression
                        currentExprStartLine = i;
                    }
                    multiLine = true;
                }
            }

            const multiLineContinuesHere =   multiLine && (currentExprStartLine !== i);
            const multiLineEndsHere      = ! multiLine && (currentExprStartLine !== -1);

            if (multiLineEndsHere && (lineArray[i].indexOf(';') !== -1)) {
                throw makeError('";" not allowed on lines ending multi-line expressions.', i);
            }
                
            if (multiLineContinuesHere || multiLineEndsHere) {
                // move line i up to the expression start
                lineArray[currentExprStartLine] += ' ' + lineArray[i].trim();
                lineArray[i] = '';
            }

            if (i === lineArray.length - 1) {
                if (multiLineEndsHere) {
                    // Expression ended the entire program
                    return lineArray;
                } else if (multiLineContinuesHere) {
                    // Ran out of length!
                    console.error();
                    throw makeError('Expression not closed before the end of the file.', currentExprStartLine);
                }
            }
                
            ++i;
        } while (multiLine);
    } // while not at end

    i = lineArray.length - 1;
    while (i > 0) {
        const prev = lineArray[i - 1];
        if (prev.match(/,\s*$/)) {
            // Pull up onto previous line
            lineArray[i - 1] = prev.trimEnd() + ' ' + lineArray[i].trimStart();
            lineArray[i] = '';
        }
        --i;
    }  // while not at end


    return lineArray;
}


/** Function that count occurrences of a substring in a string;
 * @param {String} string               The string
 * @param {String} subString            The sub string to search for
 * @param {Boolean} [allowOverlapping]  Optional. (Default:false)
 *
 * Derived from
 * @author Vitim.us https://gist.github.com/victornpb/7736865
 * @see Unit Test https://jsfiddle.net/Victornpb/5axuh96u/
 * @see http://stackoverflow.com/questions/4009756/how-to-count-string-occurrence-in-string/7924240#7924240
 */
function countOccurrences(string, subString, allowOverlapping) {
    let n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else {
            break;
        }
    }
    
    return n;
}


function countRegexOccurences(string, regex) {
    return (string.match(regex) || []).length;
}


/** Compiles pyxlscript -> JavaScript. Processes the body of a section. Use compile() to compile
    an entire project. There is no standalone mode compiler. */
function pyxlToJS(src, noYield, internalMode) {
    if (noYield === undefined) { noYield = false; }

    // Replace confusingly-similar double bars (we use exclusively Double Vertical Line 0x2016)
    src = src.replace(/∥𝄁║Ⅱǁ/g, '‖');

    // Switch to small element-of everywhere before blocks or strings can be processed
    src = src.replace(/∈/g, '∊');

    let pack = protectQuotedStrings(src);
    src = pack[0];
    let protectionMap = pack[1];

    // Remove multi-line comments, which cause problems with the indentation and end-of-line metrics
    src = src.replace(/\/\*([\s\S]*?)\*\//g, function(match, contents) {
        // Extract and return just the newlines to keep line numbers unmodified
        return contents.replace(/[^\n]/g, '');
    });

    // Remove single-line comments
    src = src.replace(/\/\/.*$/gm, '');

    // Replace spread operator
    src = src.replace(/…/g, '...');

    // Pull 'because' on a new line up to the previous line
    src = src.replace(/\)[\t ]*((?:\n[\t ]*)+)[ \t]*because[ \t]+("[^\n"]")/g, ') because $2$1');

    // Numbers ending in percent. This regex is dangerous because it
    // does not distinguish variables ending with a number from standalone
    // number tokens.
    src = src.replace(/(\d+(?:\.\d*)?)%/g, '($1 * 0.01)');

    // Numbers ending in degrees.
    src = src.replace(/(\d+|\d\.\d*)(°|[ ]*deg\b)/g, '($1 * .017453292519943295)');

    // Switch FOR loops (will be switched back later)
    src = src.replace(/<=/g, '≤');
    src = src.replace(/>=/g, '≥');
    src = src.replace(/\sin\s/g, ' ∊ ');

    {
        const lineArray = compactMultilineLiterals(src.split('\n'))
        const becauseRegExp = RegExp('(' + identifierPattern + '\\([^\\n]*\\))[ \\t]+because[ \\t]+("[^"]+")', 'g');
        for (let i = 0; i < lineArray.length; ++i) {
            let line = lineArray[i];

            // Process BECAUSE: `foo(...) because "string"` --> `(because("string"),foo(...))`
            // There must be no space between the comma and the identifier in order for the next regexp
            // to fake a negative lookbehind
            if (/\)[ \t]*because[ \t]+"/.test(line)) {
                // We can't process this with a regular expression
                // because we have to parse recursive matching
                // parentheses to find the complete expression before
                // the `because`
                let becausePos = line.indexOf('because ');
                console.assert(becausePos !== -1)

                // Extract the reason
                let reasonBeginPos = becausePos + 'because '.length;
                while (line[reasonBeginPos] !== '"') { ++reasonBeginPos; }
                let reasonEndPos = reasonBeginPos + 1;
                while (line[reasonEndPos] !== '"') { ++reasonEndPos; }
                
                
                // Look backwards for the paren
                let callEndPos = becausePos - 1;
                while (line[callEndPos] !== ')') { --callEndPos; }

                // Look farther backwards for the matching paren
                let callBeginPos = findMatchingParen(line, callEndPos, -1);

                // Move backwards over the identifier
                --callBeginPos;
                while (/[ΔA-Za-z_0-9αβγΔδζηθιλμρσϕφχψτωΩ]/.test(line[callBeginPos])) { --callBeginPos; }
                ++callBeginPos;

                lineArray[i] = line = line.substring(0, callBeginPos) + '(because(' + line.substring(reasonBeginPos, reasonEndPos + 1) + '),' +
                    line.substring(callBeginPos, callEndPos + 1) + ')' + line.substring(reasonEndPos + 1);
            }

            // Insert BECAUSE for state changes that do not use them already
            line = lineArray[i] = line.replace(/(^|[^,])((?:setMode|pushMode|popMode|launchGame|resetGame|quitGame)[ \t]*\()/g, '$1because("");$2');

            // Look for mismatched if/then/else (conservative test, misses some)
            const ifCount = countRegexOccurences(line, /\bif\b/g);
            const thenCount = countRegexOccurences(line, /\bthen\b/g);
            const elseCount = countRegexOccurences(line, /\belse\b/g);
            if (thenCount > elseCount) {
                throw makeError('"then" without "else".', i);
            } else if (thenCount > ifCount) {
                throw makeError('"then" without "if".', i);
            }
        }
        
        src = lineArray.join('\n');
    }

    // Conditional operator. Replace "if TEST then CONSEQUENT else
    // ALTERNATE" --> "TEST ? CONSEQUENT : ALTERNATE" before "if"
    // statements are parsed.

    // IF that is not at the start of a line or a block (preceeded by
    // "\n" or ":") is replaced with an open paren. There are no
    // negative lookbehinds in JavaScript, so we have to structure an
    // explicit test.
    { // Allow multiple IF...THEN on a single line by processing repeatedly
        let found = true
        while (found) {
            found = false;
            src = src.replace(/^([ \t]*\S[^\n]*?(?:[A-Za-z0-9_αβγΔδζηθιλμρσϕφχψτωΩ][ \t]|[\^=\-\+\*/><,\[{\(][ \t]*))if\b/gm,
                              function (match, prefix) {
                                  if (/else[ \t]*$/.test(prefix)) {
                                      // This was an ELSE IF, leave alone
                                      return match;
                                  } else {
                                      found = true;
                                      // Functional IF, replace
                                      return prefix + '(';
                                  }
                              });
        }
    }
    
    // THEN
    src = src.replace(/\bthen\b/g, ') ? (');
    
    // ELSE (which does not begin a block; note that chained
    // conditional operators require parentheses to make this parse
    // unambiguously)
    src = src.replace(/\belse[ \t]+(?!:|if)/g, ') : ');
    
    
    // Handle scopes and block statement translations
    {
        let lineArray = src.split('\n');
        processBlock(lineArray, 0, {}, {}, noYield, internalMode);
        src = lineArray.join('\n');
    }

    src = src.replace(/\breset\b/g, '{ throw new Error("RESET"); }');

    src = src.replace(/==(?!=)/g, ' === ');
    src = src.replace(/!=(?!=)/g, ' !== ');

    src = src.replace(/≟/g, ' === ');
    src = src.replace(/≠/g, ' !== ');
    src = src.replace(/¬/g, ' ! ');

    // Temporary rename to hide from absolute value
    src = src.replace(/\|\|/g, ' or ');
    src = src.replace(/&&/g, ' and ');

    // Floor and ceiling
    src = src.replace(/[⌉⌋]/g, ')');
    src = src.replace(/[⌈]/g, ' ceil(');
    src = src.replace(/[⌊]/g, ' floor(');

    // Process before blocks and implicit multiplication so that
    // they handle the parentheses correctly
    src = processBars(src, '|', 'abs');
    src = processBars(src, '‖', 'magnitude');

    // Process implicit multiplication twice, so that it can happen within exponents and subscripts
    for (var i = 0; i < 2; ++i) {
        // Implicit multiplication. Must be before operations that may
        // put parentheses after numbers, making the product
        // unclear. Regexp is: a (number, parenthetical expression, or
        // bracketed expression), followed by a variable name.

        // Specials and parens case
        src = src.replace(/([επξ∞½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣᵏᵘⁿ⁾₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₎]|\))[ \t]*([\(A-Za-zαβγδζηιθλμρσϕχψωΔΩτεπξ∞])/g, '$1 * $2');

        // Number case (has to rule out a variable name that ends in a number or has a number inside of it)
        src = src.replace(/([^A-Za-z0-9αβγδζηθιλμρσϕφχτψωΩ_]|^)([0-9\.]*?[0-9])[ \t]*([\(A-Za-zαβγδζηιθλμρσϕχψωΔΩτεπξ∞_])/g, '$1$2 * $3');
        
        // Fix any instances of text operators that got accentially
        // turned into implicit multiplication. If there are other
        // text operators in the future, they can be added to this
        // pattern.  This also fixes the one case where the pyxl
        // compiler does not inject {} around a loop body: the
        // for-with statement, where it needs to output a single
        // expression to compile those as if they were FOR statements.
        src = src.replace(/\*[\t ]*(xor|or|and|not|mod|bitxor|bitand|bitor|bitnot|bitshr|bitshl|for|with)(\b|\d|$)/g, ' $1$2');

        // Replace fractions
        src = src.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒]/g, function (match) { return fraction[match]; });
        
        // Replace exponents
        src = src.replace(/([⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣᵏᵘⁿ⁽⁾][⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣᵏᵘⁿ⁽⁾ ]*)/g, '^($1)');
        src = src.replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣᵏᵘⁿ⁽⁾]/g, function (match) { return superscriptToNormal[match]; });
        
        // Replace subscripts
        src = src.replace(/([₊₋₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₍₎][₊₋₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₍₎ ]*)/g, '[($1)]');
        src = src.replace(/[₊₋₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₍₎]/g, function (match) { return subscriptToNormal[match]; });

        // Back-to-back parens. Note that floor, ceiling, and abs have already been mapped to
        // ().
        src = src.replace(/\)[ \t]*\(/, ') * (');
    }

    // SIN, COS, TAN with a single argument and no parentheses. Must be processed after implicit
    // multiplication so that, e.g., 2 cos θ parses correctly with regard to the \\b
    src = src.replace(RegExp('\\b(cos|sin|tan)[ \\t]*([επΔξ]|[ \\t]+' + identifierPattern + ')', 'g'), '$1($2)');
    
    // Process after FOR-loops so that they are easier to parse
    src = src.replace(/≤/g, ' <= ');
    src = src.replace(/≥/g, ' >= ');
    
    // Expand shifts after blocks so that they aren't misparsed inside
    // FOR loops
    src = src.replace(/[◀◁](=?)/g, ' <<$1 ');
    src = src.replace(/[▶▷](=?)/g, ' >>$1 ');

    // Exponentiation
    src = src.replace(/\^/g, '**');

    src = src.replace(/(\b|\d)or(\b|\d)/g, '$1 || $2');
    src = src.replace(/∩(=?)/g, ' &$1 ');
    src = src.replace(/∪(=?)/g, ' |$1 ');

    // Optimize var**(int), which is much less efficient than var*var.
    // Note that we don't allow rnd (ξ) in here, as it is not constant!
    src = src.replace(RegExp('(.|..)[ \t]*(' + identifierPattern + ')\\*\\*\\((-?\\d)\\)', 'g'), function (match, br, identifier, exponent) {

        if (br.match(/\+\+|--|\.|\*\*/)) {
            // Order of operations may be a problem; don't substitute
            return match;
        } else {
            exponent = parseInt(exponent);

            if (exponent === 0) {
                return br + ' identifier**(0)';
            } else if (exponent < 0) {
                return br + ' (1 / (' + identifier + (' * ' + identifier).repeat(-exponent - 1) + '))';
            } else {
                return br + ' (' + identifier + (' * ' + identifier).repeat(exponent - 1) + ')';
            }
        }
    });
    
    src = src.replace(/∞|\binfinity\b/g,  ' (Infinity) ');
    src = src.replace(/\bnan\b/g,         ' (NaN) ');
    src = src.replace(/∅|\bnil\b/g,       ' (undefined) ');
    src = src.replace(/π|\bpi\b/g,        ' (_Math.PI+0) ');
    src = src.replace(/ε|\bepsilon\b/g,   ' (1e-7+0) ');
    src = src.replace(/ξ/g,               ' rnd() ');

    // Must come after exponentiation because it uses the same character
    src = src.replace(/⊕(=?)/g, ' ^$1 ');

    src = src.replace(/(\b|\d)and(\b|\d)/g, '$1 && $2');
    src = src.replace(/(\b|\d)mod(\b|\d)/g, '$1 % $2');
    src = src.replace(/(\b|\d)not(\b|\d)/g, '$1 ! $2');
    // Bitwise operations
    const bitopMap = {shl:'<<', shr:'>>', not:'~', and:'&', or:'|', xor:'^'};
    src = src.replace(/(\b|\d)bit(shl|shr|not|and|or|xor)(\b|\d)/g, function (match, a, op, b) {
        return a + bitopMap[op] + b;
    });

    // Debug statements
    src = src.replace(/\b(assert|debugPrint)\b/g, '_$1Enabled && $1');

    try {
        src = vectorify(src, {assignmentReturnsUndefined:true, scalarEscapes:true});
    } catch (e) {
        console.log(src);
        throw e;
    }

    // Cleanup formatting
    src = src.replace(/,[ \t]+/g, ', ');
    src = src.replace(/[ \t]*,/g, ',');
    src = src.replace(/;[ \t]*;/g, ';');
    src = src.replace(/(\S)[ \t]{2,}/g, '$1 ');
    src = src.replace(/_add\(__yieldCounter, 1\)/g, '__yieldCounter + 1');
    src = unprotectQuotedStrings(src, protectionMap);

    // console.log(src);
    return src;
}


/** Constructs JavaScript source code for the body of a generator function 

fileContents[url] maps URLs to their text source
isOS = "this is the OS itself, do not create a pause menu"
*/
function compile(gameSource, fileContents, isOS) {
    const separator = '\n\n////////////////////////////////////////////////////////////////////////////////////\n\n';
    const sectionSeparator = '//--------------------------------------------------------------------------------';
    
    let startModeName = '';
    
    // Protect certain variables by shadowing them, since programs
    // that overwrite (or read!) them could cause problems.
    let compiledProgram = 'const _Object = {}.constructor; let navigator, parent, Object, Array, String, Number, location, document, window, print, Math, RegExp, Date; \n';
    if (gameSource.json.flipY) {
        compiledProgram += 'setTransform(xy(0, screenSize.y), xy(1, -1), 0, 1);\n;';
    }
    compiledProgram += separator;
    
    // Compile the global code
    if (gameSource.scripts) {
        for (let i = 0; i < gameSource.scripts.length; ++i) {
            const url = gameSource.scripts[i];
            const pyxlCode = fileContents[url];
            let jsCode;
            try {
                jsCode = pyxlToJS(pyxlCode, true);
            } catch (e) {
                throw {url:url, lineNumber:e.lineNumber, message:e.message};
            }
            compiledProgram += '/*@"' + url + '"*/\n' + jsCode + separator;
        }
    }
    
    const doubleLineChars = '=═⚌';
    const splitRegex = RegExp(String.raw`(?:^|\n)[ \t]*(init|enter|frame|leave|popMode|[_A-Z]${identifierPattern})[ \t]*(\([^\n\)]*\))?[\t ]*(\bfrom[ \t]+[_A-Za-z][A-Za-z_0-9]*)?\n((?:-|─|—|━|⎯|=|═|⚌){5,})[ \t]*\n`);

    // Compile each mode
    for (let i = 0; i < gameSource.modes.length; ++i) {

        // Trust the mode to have the correct name in the gameSource
        // data structure, and just extract if from the filename.
        const mode = gameSource.modes[i];
        const modeName = mode.name.replace('*', '').replace(/^.*\//, '');
        
        // If true, this is an internal mode that is allowed to access
        // "_" private variables.
        const internalMode = modeName[0] === '_';

        // Is this the start mode?
        if ((mode.name.indexOf('*') !== -1) || (gameSource.modes.length === 1)) { startModeName = modeName; }
        
        // Eliminate \r on Windows
        const file = fileContents[mode.url] + '\n';
        const noSections = ! splitRegex.test(file);

        // Initalize the table. Note that the top-level mode code will be moved into
        // the "init" section, which cannot be explicitly declared. Each popMode is mangled
        // to include the "from" mode's name, and then added as encountered.
        const sectionTable = {init:null, enter:null, leave:null, frame:null};
        for (let name in sectionTable) {
            sectionTable[name] = {pyxlCode: '', args: '()', jsCode: '', offset: 0};
        }

        if (! noSections) {
            // Separate file into sections. Prefix a single newline so that there
            // is guaranteed to be a line before the first section.

            const sectionArray = ('\n' + file).split(splitRegex);

            // Disregard any blank space before the first section, but count the lines
            let line = countLines(sectionArray[0]) - 1;

            if (sectionArray.length % 5 === 0) { throw {url:mode.url, lineNumber:undefined, message: 'There must be at least one line between sections.'}; }

            // The separator names should be interleaved with the bodies. Extract
            // them and count lines.
            for (let s = 1; s < sectionArray.length; s += 5) {
                let name = sectionArray[s];
                const args = sectionArray[s + 1];
                const from = sectionArray[s + 2];
                const type = sectionArray[s + 3][0];
                const body = sectionArray[s + 4];
                // If this is the mode, replace the name with 'init' for the purpose of
                // defining variables.

                line += 1;
                if ((name !== 'enter') && (name !== 'popMode') && (args !== undefined)) { throw {url:mode.url, lineNumber:line, message:'Only the enter() and popMode() sections in a mode may take arguments'}; }

                if (name === 'popMode') {
                    // Generate the section
                    const otherMode = from.replace(/^from[\t ]*/,'');
                    if (otherMode[0] === '_' && ! (internalMode || isOS)) { throw {url:mode.url, lineNumber:line, message:'Illegal mode name in popMode() from section: "' + otherMode + '"'}; }
                    name = name + 'From' + otherMode;
                    sectionTable[name] = {pyxlCode: '', args: '()', jsCode: '', offset: 0};
                }
                
                const section = sectionTable[(doubleLineChars.indexOf(type) !== -1) ? 'init' : name];
                if (section === undefined) { throw {url:mode.url, lineNumber:line, message:'Illegal section name: "' + name + '"'}; }
                section.pyxlCode = body;
                section.offset = line;
                section.args = args || '()';
                line += countLines(body);
            }
            
        } else {
            sectionTable.frame.pyxlCode = file;
        }

        let wrappedPopModeFromCode = '', popModeBindings = '';
        
        for (let name in sectionTable) {
            const section = sectionTable[name];
            if (section.pyxlCode.trim() !== '') {
                try {
                    section.jsCode = pyxlToJS(section.pyxlCode, false, internalMode);
                } catch (e) {
                    throw {url:mode.url, lineNumber:e.lineNumber + section.offset, message:e.message};
                }
                section.jsCode = `/*@"${mode.url}":${section.offset}*/\n` + section.jsCode;

                const match = name.match(/^popModeFrom(.*)$/);
                if (match) {
                    popModeBindings += `, _${name}:_${name}`;
                    wrappedPopModeFromCode += `

// popMode from ${match[1]}
${sectionSeparator}
function _${name}${section.args} {
${section.jsCode}
}

`;
                }
            }
        }

        // setMode abruptly leaves executing code by throwing an exception that contains
        // a field 'nextMode' equal to the next mode object.

        const wrappedJSCode =
`// ${modeName}.pyxl
//========================================================================
const ${modeName} = (function() {

// init
${sectionSeparator}
${sectionTable.init.jsCode}

// enter
${sectionSeparator}
function _enter${sectionTable.enter.args} {
${sectionTable.enter.jsCode}
}

// leave
${sectionSeparator}
function _leave() {
${sectionTable.leave.jsCode}
}
${wrappedPopModeFromCode}

// system menu
${sectionSeparator}
function _popModeFrom_SystemMenu(callback) {
   if (callback) { callback(); }
}

// frame
${sectionSeparator}
const _frame = (function*() { 
let __yieldCounter = 0; while (true) { try {
if ((_gameMode._name[0] !== '_') && (pad[0]._pp || pad[1]._pp || pad[2]._pp || pad[3]._pp)) { pushMode(_SystemMenu); }
_processFrameHooks();
${sectionTable.frame.jsCode}
_show(); } catch (ex) { if (! ex.nextMode) throw ex; else _updateInput(); } yield; }
})();

return _Object.freeze({_enter:_enter, _frame:_frame, _popModeFrom_SystemMenu:_popModeFrom_SystemMenu, _leave:_leave${popModeBindings}, _name:'${modeName}'});
})();

`;
        compiledProgram += wrappedJSCode;            

    } // for each mode

    // Set the initial mode
    compiledProgram += 'try { setMode(' + startModeName + ', "Game start"); } catch (e) { if (! e.nextMode) { throw e; } }\n\n';

    // Main loop
    compiledProgram += '// Main loop\nwhile (true) { _gameMode._frame.next(); yield; };\n\n'

    compiledProgram = "'use strict';/*@\"resetAnimation\"*/ \n" + resetAnimationSource + separator + compiledProgram;

    // Inject line number on Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
        const lines = compiledProgram.split('\n');
        // Put after "use strict"
        lines[0] += '_currentLineNumber=1;';

        // Other lines
        for (let i = 1; i < lines.length; ++i) {
            // There are some weird cases where string split seems to
            // break in the middle of expressions, perhaps because
            // of unusual characters in the source file that turn into \n
            // under unicode rules. Detect these cases and don't insert line numbers
            // for them
            if (! /^\s*(else|\]|\)|\}|\/\/|$)/.test(lines[i]) &&
                ! /[\(,\[]$/.test(lines[i - 1])) {
                lines[i] = '_currentLineNumber=' + (i+1) + ';' + lines[i];
            }
        }
        compiledProgram = lines.join('\n');
    }

    // console.log(compiledProgram);
    return compiledProgram;
}


function countLines(s) {
    return s.split('\n').length + 1;
}

const resetAnimationSource = `
///////////////////////////////////////////////////////////////////////////////////
// Reset animation

if (_numBootAnimationFrames > 0) {
   // flash at start
   for (let i = 0; i < 13; ++i) {
     setBackground(gray(max(0, 0.75 - i / 12))); 
     _show(); yield;
   }

   const fade = min(96, _numBootAnimationFrames / 2);
   for (let k = 0; k < _numBootAnimationFrames; ++k) {
      setBackground(gray(0));
      const gradient = [rgb(1, 0.7333333333333333, 0.8666666666666667), rgb(1, 0.6666666666666666, 0.8), rgb(1, 0.26666666666666666, 0.5333333333333333), rgb(1, 0.26666666666666666, 0.5333333333333333), rgb(1, 0.26666666666666666, 0.5333333333333333), rgb(0.9333333333333333, 0.3333333333333333, 0.6), rgb(0.8666666666666667, 0.3333333333333333, 0.6), rgb(0.8, 0.4, 0.6666666666666666), rgb(0.6666666666666666, 0.4666666666666667, 0.7333333333333333), rgb(0.6, 0.4666666666666667, 0.7333333333333333), rgb(0.4666666666666667, 0.5333333333333333, 0.7333333333333333), rgb(0.4, 0.6, 0.8), rgb(0.3333333333333333, 0.6, 0.8), rgb(0.26666666666666666, 0.6666666666666666, 0.8666666666666667), rgb(0.6, 0.7333333333333333, 0.8666666666666667), rgb(0.8, 0.8666666666666667, 0.9333333333333333)];
      const N = size(gradient);

      // fade
      let v = 0;
      if (k < fade) { 
         v = k / fade;
      } else if (k < _numBootAnimationFrames - fade) {
         v = 1;
      } else {
         v = (_numBootAnimationFrames - k) / fade;
      }

      const vDot = _Math.max(0, v - 0.2) / (1.0 - 0.2);

      // dots
      const w = _SCREEN_WIDTH >> 1, h = _SCREEN_HEIGHT >> 1;
      const tmp = {r: 0, g: 0, b: 0};
      for (let i = 0; i < 16000; ++i) {
         const x = rnd(), y = rnd();
         const c = gradient[_Math.min((y * (N - 1) + 3 * rnd()) >> 0, N - 1)];
         RGB_MUL(c, vDot, tmp);
         drawPoint(xy(_Math.floor(w * x) * 2, _Math.floor(h * y) * 2), tmp);
      }

      drawSprite({sprite: _quadplayLogoSprite[0][0], pos: xy(screenSize.x * 0.5 + 0.5, screenSize.y * 0.5 + 0.5), opacity: _Math.min(1, 2 * v)})

      _show(); yield;
   }

   // Black frames
   for (let i = 0; i < fade / 2; ++i) {
      _show(); yield;
   }
   modeFrames = gameFrames = 0;
}
`;


const fraction = Object.freeze({
    '½':'(1/2)',
    '⅓':'(1/3)',
    '⅔':'(2/3)',
    '¼':'(1/4)',
    '¾':'(3/4)',
    '⅕':'(1/5)',
    '⅖':'(2/5)',
    '⅗':'(3/5)',
    '⅘':'(4/5)',
    '⅙':'(1/6)',
    '⅐':'(1/7)',
    '⅛':'(1/8)',
    '⅑':'(1/9)',
    '⅒':'(1/10)'
});


const subscriptToNormal = Object.freeze({
    '₊':'+',
    '₋':'-',
    '₀':'0',
    '₁':'1',
    '₂':'2',
    '₃':'3',
    '₄':'4',
    '₅':'5',
    '₆':'6',
    '₇':'7',
    '₈':'8',
    '₉':'9',
    'ₐ':' a ',
    'ᵦ':' β ',
    'ᵢ':' i ',
    'ⱼ':' j ',
    'ₓ':' x ',
    'ᵤ':' u ',
    'ₖ':' k ',
    'ₙ':' n ',
    '₍':'(',
    '₎':')'    
});

const superscriptToNormal = Object.freeze({
    '⁺':'+',
    '⁻':'-',
    '⁰':'0',
    '¹':'1',
    '²':'2',
    '³':'3',
    '⁴':'4',
    '⁵':'5',
    '⁶':'6',
    '⁷':'7',
    '⁸':'8',
    '⁹':'9',
    'ᵃ':' a ',
    'ᵝ':' β ',
    'ⁱ':' i ',
    'ʲ':' j ',
    'ˣ':' x ',
    'ᵘ':' u ',
    'ᵏ':' k ',
    'ⁿ':' n ',
    '⁽':'(',
    '⁾':')'});
    
