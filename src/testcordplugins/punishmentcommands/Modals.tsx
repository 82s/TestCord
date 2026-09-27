/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Forms, TextInput } from "@webpack/common";

interface Props {
    username: string;
    presetDuration?: string;
    onSubmit: (duration: string, reason: string) => Promise<void>;
}

export function openPunishModal({ username, presetDuration, onSubmit }: Props) {
    let duration = presetDuration ?? "";
    let reason = "";
    let sending = false;

    openModal(props => (
        <ErrorBoundary>
            <ModalRoot {...props} size={ModalSize.DYNAMIC}>
                <ModalHeader>
                    <Forms.FormText>Mute {username}</Forms.FormText>
                </ModalHeader>
                <ModalContent>
                    <Flex flexDirection="column">
                        {!presetDuration && (
                            <TextInput
                                placeholder="Duration, for example 2h"
                                onChange={value => { duration = value; }}
                            />
                        )}
                        <TextInput
                            placeholder="Reason (optional)"
                            onChange={value => { reason = value; }}
                        />
                    </Flex>
                </ModalContent>
                <ModalFooter>
                    <Flex justifyContent="flex-end">
                        <Button
                            variant="primary"
                            disabled={sending || (!presetDuration && !duration)}
                            onClick={async () => {
                                sending = true;
                                try {
                                    await onSubmit(duration, reason);
                                    props.onClose();
                                } finally {
                                    sending = false;
                                }
                            }}
                        >
                            Send
                        </Button>
                    </Flex>
                </ModalFooter>
            </ModalRoot>
        </ErrorBoundary>
    ));
}
