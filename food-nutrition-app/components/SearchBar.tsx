'use client';

import { useState } from 'react';

interface SearchBarProps {
    onSearch: (query: string) => void;
    isLoading: boolean;
}

export default function SearchBar({ onSearch, isLoading }: SearchBarProps) {
    const [query, setQuery] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSearch(query);
    };

    return (
        <form onSubmit={handleSubmit} style={{ maxWidth: '700px', margin: '0 auto' }}>
            <div style={{ position: 'relative' }}>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for foods (e.g., apple, chicken breast, cheddar cheese)..."
                    style={{
                        width: '100%',
                        padding: '16px 56px 16px 20px',
                        fontSize: '16px',
                        borderRadius: '16px',
                        background: 'var(--bg-card)',
                        border: '2px solid var(--border)',
                        color: 'var(--text-primary)',
                        transition: 'all 0.2s ease'
                    }}
                    onFocus={(e) => {
                        e.target.style.borderColor = 'var(--accent-primary)';
                        e.target.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)';
                    }}
                    onBlur={(e) => {
                        e.target.style.borderColor = 'var(--border)';
                        e.target.style.boxShadow = 'none';
                    }}
                />
                <button
                    type="submit"
                    disabled={isLoading}
                    style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                        border: 'none',
                        borderRadius: '12px',
                        width: '44px',
                        height: '44px',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        opacity: isLoading ? 0.6 : 1
                    }}
                    onMouseEnter={(e) => {
                        if (!isLoading) {
                            e.currentTarget.style.transform = 'translateY(-50%) scale(1.05)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.4)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                >
                    {isLoading ? (
                        <div style={{
                            width: '20px',
                            height: '20px',
                            border: '2px solid white',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite'
                        }} />
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                    )}
                </button>
            </div>
            <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        </form>
    );
}
