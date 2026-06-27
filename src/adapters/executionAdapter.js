"use strict";

/**
 * Interface contract for execution-capable adapters.
 *
 * execute():
 *  - receives a normalized request envelope
 *  - performs exactly one bounded execution action
 *  - returns standardized execution evidence
 *
 * verify():
 *  - performs read-back verification
 *  - returns standardized verification evidence
 */

class ExecutionAdapter {
    constructor(name) {
        this.name = name || "ExecutionAdapter";
    }

    /**
     * Execute a bounded write action.
     * @param {object} requestEnvelope
     * @returns {Promise<object>}
     */
    async execute(requestEnvelope) {
        throw new Error(`${this.name}.execute() is not implemented.`);
    }

    /**
     * Verify expected postcondition by read-back.
     * @param {object} requestEnvelope
     * @param {object} executionResult
     * @returns {Promise<object>}
     */
    async verify(requestEnvelope, executionResult) {
        throw new Error(`${this.name}.verify() is not implemented.`);
    }
}

module.exports = {
    ExecutionAdapter
};
