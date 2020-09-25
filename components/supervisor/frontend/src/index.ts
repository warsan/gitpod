/**
 * Copyright (c) 2020 TypeFox GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License-AGPL.txt in the project root for license information.
 */

require('../public/index.css');

import "reflect-metadata";
import { createGitpodService, GitpodClient, WorkspaceInfo } from "@gitpod/gitpod-protocol";
import { GitpodHostUrl } from "@gitpod/gitpod-protocol/lib/util/gitpod-host-url";
import { makeLink } from "@gitpod/gitpod-protocol/lib/util/make-link";
import { WorkspaceInfoResponse } from '@gitpod/supervisor-api-grpc/lib/info_pb';

const workspaceUrl = new GitpodHostUrl(window.location.href);
window.gitpod = {
    service: createGitpodService(workspaceUrl.withoutWorkspacePrefix().toString())
};
if (!workspaceUrl.workspaceId) {
    document.title += ': Unknown workspace';
    console.error(`Failed to extract a workspace id from '${window.location.href}'.`)
} else {
    window.gitpod.service.server.getWorkspace(workspaceUrl.workspaceId)
        .then(info => main(info));
}


const checkReady: (kind: 'content' | 'ide' | 'supervisor') => Promise<void> = kind =>
    fetch(window.location.protocol + '//' + window.location.host + '/_supervisor/v1/status/' + kind + '/wait/true').then(response => {
        if (response.ok) {
            return;
        }
        console.debug(`failed to check whether ${kind} is ready, trying again...`, response.status, response.statusText);
        return checkReady(kind);
    }, e => {
        console.debug(`failed to check whether ${kind} is ready, trying again...`, e);
        return checkReady(kind);
    });
const supervisorReady = checkReady('supervisor');
const ideReady = supervisorReady.then(() => checkReady('ide'));
const contentReady = supervisorReady.then(() => checkReady('content'));


let lastActivity = 0;
const updateLastActivitiy = () => {
    lastActivity = new Date().getTime();
};
const trackLastActivity = (w: Window) => {
    w.document.addEventListener('mousemove', updateLastActivitiy, { capture: true });
    w.document.addEventListener('keydown', updateLastActivitiy, { capture: true });
}
trackLastActivity(window);
supervisorReady.then(async () => {
    const response = await fetch(window.location.protocol + '//' + window.location.host + '/_supervisor/v1/info/workspace', { credentials: 'include' });
    const { instanceId }: WorkspaceInfoResponse.AsObject = await response.json();
    const sendHeartBeat = async (wasClosed?: true) => {
        try {
            await window.gitpod.service.server.sendHeartBeat({ instanceId, wasClosed });
        } catch (err) {
            console.error('Failed to send hearbeat:', err);
        }
    }
    sendHeartBeat();
    window.addEventListener('beforeunload', () => sendHeartBeat(true), { once: true });

    let activityInterval = 10000;
    setInterval(() => {
        if (lastActivity + activityInterval < new Date().getTime()) {
            // no activity, no heartbeat
            return;
        }
        sendHeartBeat();
    }, activityInterval);
});


const main = (info: WorkspaceInfo) => {
    document.title = info.workspace.description;

    const startUrl = workspaceUrl.withoutWorkspacePrefix().with({
        pathname: '/start/',
        hash: '#' + info.workspace.id
    }).toString();

    const loadingFrame = document.createElement('iframe');
    loadingFrame.src = startUrl;
    loadingFrame.className = 'gitpod-frame loading';
    document.body.appendChild(loadingFrame);
    loadingFrame.contentWindow?.addEventListener('DOMContentLoaded', () => {
        if (loadingFrame.contentWindow) {
            trackLastActivity(loadingFrame.contentWindow);
        }
    }, { once: true });

    const ideURL = new URL(window.location.href);
    ideURL.searchParams.append('gitpod-ide-index', 'true');

    const ideFrame = document.createElement('iframe');
    ideFrame.src = ideURL.href;
    ideFrame.className = 'gitpod-frame ide';
    ideFrame.style.visibility = 'hidden';
    Promise.all([ideReady, contentReady]).then(() => {
        console.info('IDE backend and content are ready, attaching IDE frontend...');
        document.body.appendChild(ideFrame);
        ideFrame.contentWindow?.addEventListener('DOMContentLoaded', () => {
            if (ideFrame.contentWindow) {
                trackLastActivity(ideFrame.contentWindow);
                ideFrame.contentWindow.gitpod = window.gitpod;
            }
            if (navigator.keyboard?.getLayoutMap && ideFrame.contentWindow?.navigator.keyboard?.getLayoutMap) {
                ideFrame.contentWindow.navigator.keyboard.getLayoutMap = navigator.keyboard.getLayoutMap.bind(navigator.keyboard);
            }
            if (navigator.keyboard?.addEventListener && ideFrame.contentWindow?.navigator.keyboard?.addEventListener) {
                ideFrame.contentWindow.navigator.keyboard.addEventListener = navigator.keyboard.addEventListener.bind(navigator.keyboard);
            }
        }, { once: true });
    });

    const overlayFrame = document.createElement('iframe');
    overlayFrame.className = 'gitpod-frame overlay';
    overlayFrame.style.visibility = 'hidden';
    document.body.append(overlayFrame);
    trackLastActivity(overlayFrame.contentWindow!);

    const titleNode = overlayFrame.contentDocument!.createElement('div');
    const status = overlayFrame.contentDocument!.createElement('div');
    const message = overlayFrame.contentDocument!.createElement('div');
    const spinner = overlayFrame.contentDocument!.createElement('div');
    spinner.classList.add('fa', 'fa-circle-o-notch', 'fa-spin'); // TODO styles
    const startButton = overlayFrame.contentDocument!.createElement('button');
    startButton.textContent = 'Start';
    startButton.onclick = () => {
        window.location.href = startUrl;
    };
    const dashboardButton = document.createElement("button");
    dashboardButton.textContent = 'Workspaces';
    makeLink(dashboardButton, workspaceUrl.asDashboard().toString(), 'Workspaces');
    const contextUrlButton = document.createElement("button");
    contextUrlButton.textContent = 'View on ' + new URL(info.workspace.contextURL).host;
    contextUrlButton.onclick = () => {
        window.open(info.workspace.contextURL, '_self');
    }
    overlayFrame.contentDocument!.body.append(titleNode);
    overlayFrame.contentDocument!.body.append(status);
    overlayFrame.contentDocument!.body.append(message);
    overlayFrame.contentDocument!.body.append(spinner);
    overlayFrame.contentDocument!.body.append(startButton);
    overlayFrame.contentDocument!.body.append(dashboardButton);
    overlayFrame.contentDocument!.body.append(contextUrlButton);

    let stopped = false;
    const onInstanceUpdate: GitpodClient['onInstanceUpdate'] = instance => {
        if (instance.workspaceId !== info.workspace.id) {
            // not for us
            return;
        }
        if (instance.status.phase === 'stopped') {
            stopped = true;
        }
        titleNode.textContent = `Workspace Not Running`;
        status.textContent = instance.status.phase;
        if (instance.status.conditions.timeout) {
            message.textContent = "Workspace has timed out.";
        } else if (instance.status.conditions.failed) {
            message.textContent = instance.status.conditions.failed;
        } else if (instance.status.message) {
            message.textContent = instance.status.message;
        }
        if (message.textContent) {
            // capitalize message
            message.textContent = message.textContent.charAt(0).toUpperCase() + message.textContent.slice(1);

            if (!message.textContent.endsWith(".")) {
                message.textContent += ".";
            }
        }

        // If this workspace is currently starting, redirect to the "/start" page to provide a consistent experience.
        // Note: we only want to redirect here if the workspace was stopped before. If it wasn't this status change is probably a fluke
        //       and we don't want to forcefully move the user away from their work.
        if (stopped && (instance.status.phase === 'preparing' || instance.status.phase === 'creating' || instance.status.phase === 'initializing')) {
            startButton.click();
        }

        if (instance.status.phase !== 'running') {
            if (instance.status.phase === 'stopped') {
                spinner.style.visibility = 'hidden';
                startButton.style.visibility = 'visible';
            } else {
                spinner.style.visibility = 'visible';
                startButton.style.visibility = 'hidden';
            }
            ideFrame.style.visibility = 'hidden';
            overlayFrame.style.visibility = 'visible';
        } else {
            loadingFrame.remove();
            ideFrame.style.visibility = 'visible';
            overlayFrame.style.visibility = 'hidden';
        }
    }
    window.gitpod.service.registerClient({ onInstanceUpdate });
    window.gitpod.service.server.onDidOpenConnection(async () => {
        info = await window.gitpod.service.server.getWorkspace(info.workspace.id);
        if (info.latestInstance) {
            onInstanceUpdate(info.latestInstance);
        }
    });
    window.document.addEventListener('visibilitychange', async () => {
        if (window.document.visibilityState === 'visible') {
            info = await window.gitpod.service.server.getWorkspace(info.workspace.id);
            if (info.latestInstance) {
                onInstanceUpdate(info.latestInstance);
            }
        }
    });
    if (info.latestInstance) {
        onInstanceUpdate(info.latestInstance);
    }
};