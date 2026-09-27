import { useState } from 'react';

/** Commit-on-blur/Enter number field; external updates pass through while unfocused. */
export function NumberInput({ value, onCommit, ...props }) {
    const [draft, setDraft] = useState(null);
    const shown = String(value);
    const commit = () => { if (draft !== null) {
        const text = draft;
        setDraft(null);
        if (text !== shown)
            onCommit(text);
    } };
    return <input type="number" value={draft ?? shown} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
    } }} {...props} />;
}
