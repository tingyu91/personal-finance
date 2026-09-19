// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  beforeEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('shows the five screens in the rail, in order', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Overview', 'Transactions', 'Home project', 'Insights', 'Statements']);
  });

  it('opens on Overview with one page title and marks it current', () => {
    render(<App />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview');
    const current = screen.getByRole('navigation', { name: 'Screens' }).querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Overview');
  });

  it('follows the hash route', async () => {
    render(<App />);
    await act(async () => {
      window.location.hash = '#/home-project';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home project');
  });
});
