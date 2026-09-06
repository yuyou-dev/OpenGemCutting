import { IconArrowUpRight, IconBrandGithub } from "@tabler/icons-react";

export function RepositoryLink() {
  return (
    <a className="repository-link" href="https://github.com/yuyou-dev/OpenGemCutting" target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库（新标签页打开）">
      <IconBrandGithub size={16} stroke={1.7} aria-hidden="true" />
      <span>GitHub 仓库</span>
      <IconArrowUpRight size={13} stroke={1.7} aria-hidden="true" />
    </a>
  );
}
