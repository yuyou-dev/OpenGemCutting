import { APP_VERSION } from '../version.js';

const logoUrl = `${import.meta.env.BASE_URL}brand/logo-header.webp`;

export function Header({ onHelp, onFiles }) {
    return <header className="ps-header">
        <div className="ps-brand">
            <img src={logoUrl} alt="" />
            <span className="ps-brand-text">
                <span className="ps-brand-title"><strong>冠亭预设工作室</strong><em>{APP_VERSION}</em></span>
                <small>SUVA · OPENGEMCUTTING 冠亭预设系列</small>
            </span>
        </div>
        <div className="ps-header-actions">
            <button type="button" onClick={onHelp}>使用说明</button>
            <button type="button" onClick={onFiles}>导入 / 导出</button>
        </div>
    </header>;
}
