// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

var VsCode = require('vscode');
var Window = VsCode.window;
var commands = VsCode.commands;
var workspace = VsCode.workspace;
var Position = VsCode.Position;

var path = require('path');
var fs = require('fs');
var git = require('parse-git-config');
var parse = require('github-url-from-git');
var open = require('open');
var copy = require('copy-paste').copy
var gitRev = require('git-rev-2');
var process = require('child_process');

function getGitHubLink(cb) {
    var cwd = workspace.rootPath;
    var repoRootDirectory = null;
    var repoRelativePath = "";
    
    try {
      // determine the associated git repo: if cwd is not a git repo, we will search up until we find one
      repoRootDirectory = process.execSync('git rev-parse --show-toplevel', { cwd: cwd }).toString().replace('\n','');
      // if repo root is not cwd, repoRelativePath will be the path relative path to get from repo root to workspace root
      repoRelativePath = cwd.replace(repoRootDirectory, "");
    } catch (ex) {
      // error: just use cwd
      repoRootDirectory = cwd;
    }

    git({
        cwd: repoRootDirectory
    }, function (err, config) {
        var rawUri, parseOpts, lineIndex = 0, parsedUri, branch, editor, selection
            , projectName, subdir, gitLink, scUrls, workspaceConfiguration;

        workspaceConfiguration = VsCode.workspace.getConfiguration("openInGitHub");
        scUrls = {
            github: 'https://' + workspaceConfiguration.gitHubDomain,
            bitbucket: 'https://bitbucket.org',
            visualstudiocom: /^https:\/\/[\w\d-]*\.visualstudio.com\//
        }

        rawUri = config['remote \"origin\"'].url;
        parseOpts = {
            extraBaseUrls: [
                'bitbucket.org',
                workspaceConfiguration.gitHubDomain
            ]
        }

        rawUri = rawUri.replace('bitbucket.org:', 'bitbucket.org/')

        parsedUri = parse(rawUri, parseOpts);
        if (!parsedUri) {
            parsedUri = rawUri;
        }

        gitRev.branch(repoRootDirectory, function (branchErr, branch) {
            if (branchErr || !branch)
                branch = 'master';
            editor = Window.activeTextEditor;
            if (editor) {
                selection = editor.selection;

                lineIndex = selection.active.line + 1;
                projectName = parsedUri.substring(parsedUri.lastIndexOf("/") + 1, parsedUri.length);

                subdir = repoRelativePath + editor.document.uri.fsPath.substring(workspace.rootPath.length).replace(/\"/g, "");

                if (parsedUri.startsWith(scUrls.github)) {
                    gitLink = parsedUri + "/blob/" + branch + subdir + "#L" + lineIndex;
                } else if (parsedUri.startsWith(scUrls.bitbucket)) {
                    gitLink = parsedUri + "/src/" + branch + subdir + "#cl-" + lineIndex;
                } else if (scUrls.visualstudiocom.test(parsedUri)) {
                    gitLink = parsedUri + "#path=" + subdir + "&version=GB" + branch;
                } else {
                    Window.showWarningMessage('Unknown Git provider.');
                }
            } else {
                gitLink = gitLink = parsedUri + "/tree/" + branch;
            }

        if (gitLink)
            cb(gitLink);
        });
    });
}

function openInGitHub() {
	getGitHubLink(open);
}

function copyGitHubLinkToClipboard() {
	getGitHubLink(copy);
}

function activate(context) {
    context.subscriptions.push(commands.registerCommand('extension.openInGitHub', openInGitHub));
    context.subscriptions.push(commands.registerCommand('extension.copyGitHubLinkToClipboard', copyGitHubLinkToClipboard));
}

exports.activate = activate;