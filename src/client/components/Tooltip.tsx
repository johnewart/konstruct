import React from 'react';
import './Tooltip.css';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  return (
    <div className="tooltip">
      {children}
      <span className="tooltip-text">{content}</span>
    </div>
  );
};
