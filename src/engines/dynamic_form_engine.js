function buildFormDefinition(request) {

    const required_fields = [];

    if (request.action === "ASSIGN_USER_TO_APP") {
        required_fields.push({
            name: "justification",
            required: true,
            validation: { min_length: 15 }
        });
    }

    const missing_fields = required_fields
        .filter(f => {
            const val = request.collected_data[f.name];
            if (!val) return true;
            if (f.validation?.min_length && val.length < f.validation.min_length) return true;
            return false;
        })
        .map(f => f.name);

    return {
        required_fields,
        missing_fields,
        can_submit_now: missing_fields.length === 0
    };
}

module.exports = { buildFormDefinition };