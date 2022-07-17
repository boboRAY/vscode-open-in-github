'use strict';

const workspace = require('vscode').workspace
const querystring = require('querystring');
const gitUrlParse = require('git-url-parse');
const path = require('path');
const useCommitSHAInURL = workspace.getConfiguration('openInGitHub').get('useCommitSHAInURL', false);

class BaseProvider {
    constructor(gitUrl, sha) {
        this.gitUrl = gitUrl;
        this.sha = sha;
    }

    get baseUrl() {
        return this.gitUrl.toString(providerProtocol).replace(/(\.git)$/, '');
    }

    /**
     * Get the Web URL.
     *
     * @param {string} branch
     * @param {string} filePath The file path relative to repository root, beginning with '/'.
     * @param {number} line
     * @param {number} endLine The last line in a multi-line selection
     * @return {string} The URL to be opened with the browser.
     */
    webUrl(sha, branch, filePath, line, endLine) {
        return '';
    }
    prUrl(branch) {
        return '';
    }
}

class GitHub extends BaseProvider {
    webUrl(sha, branch, filePath, line, endLine) {
        let blob = sha;
        if (useCommitSHAInURL) {
            blob = this.sha;
        }
        if (filePath) {
            return `${this.baseUrl}/blob/${blob}${filePath}` + (line ? '#L' + line : '') + (endLine ? '-L' + endLine : '');
        }
        return `${this.baseUrl}/tree/${blob}`;
    }
    prUrl(sha) {
        return `${this.baseUrl}/pull/new/${sha}`;
    }
}

class GitLab extends BaseProvider {
    webUrl(sha, branch, filePath, line, endLine) {
        if (filePath) {
            return `${this.baseUrl}/blob/${sha}` + (filePath ? `${filePath}` : '') + (line ? `#L${line}` : '');
        }
        return `${this.baseUrl}/tree/${sha}`;
    }
    prUrl(sha) {
        //https://docs.gitlab.com/ee/api/merge_requests.html#create-mr
        //`${this.baseUrl}/pull-requests/new?source_branch=${branch}&target_branch=${????}&title=${????}`
        throw new Error(`Doesn't support Merge Request from URL in GitLab yet`);
    }
}

class Gitea extends BaseProvider {
    webUrl(sha, branch, filePath, line, endLine) {
        let blobPath = `branch/${sha}`;
        if (useCommitSHAInURL) {
            blobPath = `commit/${this.sha}`;
        }
        if (filePath) {
            return `${this.baseUrl}/src/${blobPath}` + (filePath ? `${filePath}` : '') + (line ? `#L${line}` : '');
        }
        return `${this.baseUrl}/src/${blobPath}`;
    }
    prUrl(sha) {
        throw new Error(`Doesn't support Merge Request from URL in Gitea yet`);
    }
}

class Bitbucket extends BaseProvider {
    webUrl(sha, branch, filePath, line, endLine) {
        const fileName = path.basename(filePath)
        return `${this.baseUrl}/src/${this.sha}` + (filePath ? `${filePath}` : '') + (line ? `#${fileName}-${line}` : '');
    }
    prUrl(sha) {
        const repo = this.baseUrl.replace(`${providerProtocol}://bitbucket.org/`, '')
        return `${this.baseUrl}/pull-requests/new?source=${repo}%3A%3A${sha}&dest=${repo}%3A%3Aintegration`;
        // looks like this:
        // https://bitbucket.org/${org/repo}/pull-requests/new?source=${org/repo}%3A%3A${branch}&dest=${org/repo}%3A%3A${destBranch}
    }
}

class VisualStudio extends BaseProvider {
    get baseUrl() {
        return `https://${this.gitUrl.resource}${this.gitUrl.pathname}`.replace(/\.git/, '');
    }

    webUrl(sha, branch, filePath, line, endLine, col, endCol) {
        let query = {
            version: `GB${branch}`,
        };
        if (filePath) {
            query['path'] = filePath;
        }
        if (line) {
            query['line'] = line;
            query['lineEnd'] = lineEnd;
            query['lineStartColumn'] = lineStartColumn;
            query['lineEndColumn'] = lineEndColumn;
        }
        return `${this.baseUrl}?${querystring.stringify(query)}`;
    }

    prUrl(branch) {
        throw new Error(`Doesn't support Merge Request from URL in VisualStudio.com yet`);
    }
}

class CustomProvider extends BaseProvider {
    constructor(gitUrl, sha) {
        super(gitUrl, sha);
        this.customProviderPath = workspace.getConfiguration('openInGitHub').get('customProviderPath', '');
        this.customBlobPath = workspace.getConfiguration('openInGitHub').get('customBlobPath', '+');
        this.customLinePrefix = workspace.getConfiguration('openInGitHub').get('customLinePrefix', '#');
    }
    get baseUrl() {
        return `${this.customProviderPath}${this.gitUrl.pathname}`.replace(/\.git/, '');
    }
    webUrl(sha, branch, filePath, line, endLine) {
        if (filePath) {
            const lineURL = line ? `${this.customLinePrefix}${line}` : '';
            const branchPath = alwaysOpenInDefaultBranch ? defaultPrBranch : branch;
            return `${this.baseUrl}/${this.customBlobPath}/${branchPath}${filePath}${lineURL}`;
        }
        return `${this.baseUrl}/tree/${branch}`;
    }
    prUrl(branch) {
        throw new Error(`Doesn't support Merge Request from URL in custom git repo yet`);
    }
}

const gitHubDomain = workspace.getConfiguration('openInGitHub').get('gitHubDomain', 'github.com');
const giteaDomain = workspace.getConfiguration('openInGitHub').get('giteaDomain', 'gitea.io');
const providerType = workspace.getConfiguration('openInGitHub').get('providerType', 'unknown');
const providerProtocol = workspace.getConfiguration('openInGitHub').get('providerProtocol', 'https');
const defaultPrBranch = workspace.getConfiguration('openInGitHub').get('defaultPullRequestBranch', 'integration')
const alwaysOpenInDefaultBranch = workspace.getConfiguration('openInGitHub').get('alwaysOpenInDefaultBranch', false);

const providers = {
    [gitHubDomain]: GitHub,
    'gitlab.com': GitLab,
    [giteaDomain]: Gitea,
    'bitbucket.org': Bitbucket,
    'visualstudio.com': VisualStudio,
    'custom': CustomProvider
};

/**
 * Get the Git provider of the remote URL.
 *
 * @param {string} remoteUrl
 * @return {BaseProvider|null}
 */
function gitProvider(remoteUrl, sha) {
    const gitUrl = gitUrlParse(remoteUrl);
    for (const domain of Object.keys(providers)) {
        if (domain === gitUrl.resource || domain === gitUrl.source) {
            return new providers[domain](gitUrl, sha);
        } else if (domain.indexOf(providerType) > -1) {
            return new providers[domain](gitUrl, sha);
        }
    }
    throw new Error('unknown Provider');
}

module.exports = gitProvider;
