export interface ParsedTransactionData {
    instructionType: string;
    launchPubkey?: string;
}

function detectInstruction(logs: string[]): string {
    const allLogs = logs.join(' ').toLowerCase();

    const patterns = [
        { name: 'completeLaunch', match: ['completelaunch', 'complete launch'] },
        { name: 'initializeLaunch', match: ['initializelaunch'] },
        { name: 'startLaunch', match: ['startlaunch'] },
        { name: 'fund', match: ['fund'] },
        { name: 'refund', match: ['refund'] },
        { name: 'claim', match: ['claim'] },
    ];

    for (const { name, match } of patterns) {
        if (match.some(m => allLogs.includes(m))) return name;
    }

    return 'unknown';
}

export function parseMetaDAOTransaction(logs: string[]): ParsedTransactionData {
    return { instructionType: detectInstruction(logs) };
}

export function isCompleteLaunchTransaction(parsed: ParsedTransactionData): boolean {
    return parsed.instructionType === 'completeLaunch';
}

