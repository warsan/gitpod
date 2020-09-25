/**
 * Copyright (c) 2020 TypeFox GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License-AGPL.txt in the project root for license information.
 */

import { MessageService } from "@theia/core";
import { BaseWidget, Widget } from "@theia/core/lib/browser";
import { ConnectionStatusService } from "@theia/core/lib/browser/connection-status-service";
import { GitpodClient } from "@gitpod/gitpod-protocol";
import { GitpodService } from "@gitpod/gitpod-protocol";
import { GitpodHostUrl } from "@gitpod/gitpod-protocol/lib/util/gitpod-host-url";
import { formatHours } from "@gitpod/gitpod-protocol/lib/util/date-time";
import { GitpodInfo } from "../../common/gitpod-info";

export class GitpodNotRunningOverlay extends BaseWidget {

    protected readonly cancelReview: HTMLButtonElement;

    protected outOfCreditShowing = false;

    constructor(service: GitpodService, info: GitpodInfo, messageService: MessageService, connectionStatus: ConnectionStatusService) {
        super();
        this.addClass('dialogOverlay');

        try {
            const onCreditAlert = (creditAlert: any /* CreditAlert */) => {
                if (creditAlert.remainingUsageHours <= 0) {
                    // spinner.style.visibility = 'hidden';
                    // startButton.style.visibility = 'hidden';
                    // titleNode.textContent = 'Gitpod Credit Alert';
                    // status.textContent = 'You have run out of Gitpod Hours.';
                    /* contextUrlButton.onclick = () => {
                        const url = new GitpodHostUrl(info.host).asUpgradeSubscription().toString();
                        window.open(url, '_blank');
                    }
                    contextUrlButton.textContent = 'Upgrade Subscription'; */
                    this.outOfCreditShowing = true;
                    this.open();
                } else {
                    const action = 'Add Credits';
                    messageService.warn(`Remaining usage time: ${formatHours(creditAlert.remainingUsageHours)}h`, { timeout: -1 }, action).then(result => {
                        if (action === result) {
                            const url = new GitpodHostUrl(info.host).asUpgradeSubscription().toString();
                            window.open(url, '_blank');
                        }
                    });
                }
            }
            const partialClient: Partial<GitpodClient> = {
                onCreditAlert   // IO concern
            } as Partial<GitpodClient>;
            service.registerClient(partialClient)
        } catch (err) {
            console.error(err);
        }

        this.update();
    }

    open() {
        if (!this.isAttached) {
            Widget.attach(this, document.body);
        }
        super.show()
        this.activate();
    }
}
