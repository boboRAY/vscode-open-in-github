// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

var VsCode = require('vscode');
var Window = VsCode.window;
var commands = VsCode.commands;
var workspace = VsCode.workspace;
var Position = VsCode.Position;

var path = require('path');
var fs = require('fs');
var gitRev = require('git-rev-2');
var findParentDir = require('find-parent-dir');
var ini = require('ini');

const gitProvider = require('./gitProvider');
const requireSelectionForLines = workspace.getConfiguration('openInGitHub').get('requireSelectionForLines');

function open(url){
    VsCode.env.openExternal(VsCode.Uri.parse(url))
}

function copy(url){
    VsCode.env.clipboard.writeText(url)
}


function getGitProviderLink(cb, fileFsPath, lines, pr) {
    var repoDir = findParentDir.sync(fileFsPath, '.git');
    if (!repoDir) {
        throw 'Cant locate .git repository for this file';
    }

    locateGitConfig(repoDir)
        .then(readConfigFile)
        .then(config => {

            gitRev.long(repoDir, function (branchErr, sha) {
                var rawUri,
                    configuredBranch,
                    provider = null,
                    remoteName;

                gitRev.branch(repoDir, function (branchErr, branch) {
                    // Check to see if the branch has a configured remote
                    configuredBranch = config[`remote "${branch}"`];

                    if (configuredBranch) {
                        // Use the current branch's configured remote
                        remoteName = configuredBranch.remote;
                        rawUri = config[`remote "${remoteName}"`].url;
                    } else {
                        const remotes = Object.keys(config).filter(k => k.startsWith('remote '));
                        if (remotes.length > 0) {
                            rawUri = config[remotes[0]].url;
                        }
                    }

                    if (!rawUri) {
                        Window.showWarningMessage(`No remote found on branch.`);
                        return;
                    }

                    try {
                        provider = gitProvider(rawUri, sha);
                    } catch (e) {
                        let errmsg = e.toString();
                        Window.showWarningMessage(`Unknown Git provider. ${errmsg}`);
                        return;
                    }

                    let formattedFilePath = path.relative(repoDir, fileFsPath).replace(/\\/g, '/');
                    formattedFilePath = formattedFilePath.replace(/\s{1}/g, '%20');

                    let subdir = repoDir !== fileFsPath ? '/' + formattedFilePath : '';

                    if (pr) {
                        try {
                            cb(provider.prUrl(branch));
                        } catch (e) {
                            Window.showWarningMessage(e.toString());
                            return;
                        }
                    } else {
                        if (lines) {
                            var line0 = lines[0][0];
                            var col0 = lines[0][1];
                        
                            var line1 = lines[1][0];
                            var col1 = lines[1][1];
                            cb(provider.webUrl(sha, branch, subdir, line0, line1, col0, col1));
                        } else {
                            cb(provider.webUrl(sha, branch, subdir));
                        }
                    }
                });
            });
        });
}

function locateGitConfig(repoDir) {
    return new Promise((resolve, reject) => {
        fs.lstat(path.join(repoDir, '.git'), (err, stat) => {
            if (err) {
                reject(err);
            }
            if (stat.isFile()) {
                // .git may be a file, similar to symbolic link, containing "gitdir: <relative path to git dir>""
                // this happens in gitsubmodules
                fs.readFile(path.join(repoDir, '.git'), 'utf-8', (err, data) => {
                    if (err) {
                        reject(err);
                    }
                    
                    var match = data.match(/gitdir: (.*)/)[1];
                    if (!match) {
                        reject('Unable to find gitdir in .git file');
                    }
                    var configPath = path.join(repoDir, match, 'config');
                    
                    // for worktrees traverse up to the main .git folder
                    var workTreeMatch = match.match(/\.git\/worktrees*/);
                    if(workTreeMatch) {
                        var mainGitFolder = match.slice(0, workTreeMatch.index);
                        var configPath = path.join(mainGitFolder, '.git','config');
                        
                    }
                    resolve(configPath);
                });
            } else {
                resolve(path.join(repoDir, '.git', 'config'));
            }
        });
    });
}

function readConfigFile(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, 'utf-8', (err, data) => {
            if (err) {
                console.error(err);
                reject(err);
            }
            resolve(ini.parse(data));
        });
    });
}

function getGitProviderLinkForFile(fileFsPath, cb) {
    getGitProviderLink(cb, fileFsPath);
}

function getGitProviderLinkForCurrentEditorLines(cb) {
    var editor = Window.activeTextEditor;
    var fileFsPath = editor.document.uri.fsPath;

    if (includeLines(editor)) {
        getGitProviderLink(cb, fileFsPath, getSelectedLines(editor));
    } else {
        getGitProviderLinkForFile(fileFsPath, cb);
    }
}

function includeLines(editor) {
    return !requireSelectionForLines || !editor.selection.isEmpty;
}

function getSelectedLines(editor) {
    var anchorLineIndex = editor.selection.anchor.line + 1;
    var anchorColIndex = editor.selection.anchor.character + 1;

    var activeLineIndex = editor.selection.active.line + 1;
    var activeColIndex = editor.selection.active.character + 1;

    return [[anchorLineIndex, anchorColIndex] , [activeLineIndex, activeColIndex]].sort(function (a, b) {
        return a[0] - b[0]
    });
}

function getGitProviderLinkForRepo(cb) {
    getGitProviderLink(cb, workspace.rootPath);
}

function getGitProviderPullRequest(args, cb) {
    let fsPath;

    if (args && args.fsPath) {
        fsPath = args.fsPath;
    } else if (Window.activeTextEditor) {
        fsPath = Window.activeTextEditor.document.uri.fsPath;
    }

    getGitProviderLink(cb, fsPath, undefined, true);
}

function branchOnCallingContext(args, cb, pr) {
    if (pr) {
        return getGitProviderPullRequest(args, cb);
    }

    if (Window.activeTextEditor) {
        getGitProviderLinkForCurrentEditorLines(cb);
    } else if (args && args.fsPath) {
        getGitProviderLinkForFile(args.fsPath, cb);
    } else {
        // TODO: This missed in code review so should be refactored, it is broken.
        getGitProviderLinkForRepo(cb);
    }
}


function openInGitProvider(args) {
    branchOnCallingContext(args, open);
}

function copyGitProviderLinkToClipboard(args) {
    branchOnCallingContext(args, copy);
}

function openPrGitProvider(args) {
    branchOnCallingContext(args, open, true);
}

function activate(context) {
    commands.registerCommand('extension.openInGitHub', openInGitProvider);
    commands.registerCommand('extension.copyGitHubLinkToClipboard', copyGitProviderLinkToClipboard);
    commands.registerCommand('extension.openPrGitProvider', openPrGitProvider);
}

exports.activate = activate;
