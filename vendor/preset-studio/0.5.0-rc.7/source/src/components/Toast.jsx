export function Toast({ toast }) {
    return <div className="ps-toast" role="status">{toast.text}</div>;
}
