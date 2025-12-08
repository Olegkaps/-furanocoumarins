// AI generated and totally sucks
import React, { useState, useEffect } from 'react';

// data types
type Column = string;
type Operation = '==' | '!=' | '>' | '<' | 'CONTAINS';

const OPERATIONS: Operation[] = ['==', '!=', '>', '<', 'CONTAINS'];

interface AutocompleteProps {
    columns: Column[];
    value: string;
    onChange: (value: string) => void;
}

export const SearchAutocomplete: React.FC<AutocompleteProps> = ({
    columns,
    value,
    onChange,
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Generate suggestions
  useEffect(() => {
    const input = value.trim();
    const suggestions: string[] = [];

    // empty string / bracket or operator at the end — show common template
    if (
      !input ||
      /\s$|[=><!()]$/.test(input)
    ) {
      columns.forEach((col) => {
        OPERATIONS.forEach((op) => {
          suggestions.push(`${col} ${op} `);
        });
      });
    } else {
      // trying analyze end part
      const lastToken = input.split(/\s+/).pop() || '';
      
      // ends with column name — offer operation
      columns.forEach((col) => {
        if (lastToken.startsWith(col)) {
          OPERATIONS.forEach((op) => {
            suggestions.push(`${col} ${op} `);
          });
        }
      });

      // column + operation — suggest value
      // AI sucks here (and everywhere out here)
      const match = input.match(/(\w+)\s+(==|!=|>|<|CONTAINS)\s+$/);
      if (match) {
        const [, col, op] = match;
        suggestions.push(`${col} ${op} ""`);
      }
    }

    setSuggestions(suggestions);
  }, [value, columns]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const insertSuggestion = (suggestion: string) => {
    const newValue = value.endsWith(' ') || !value
      ? value + suggestion
      : value + ' ' + suggestion;
    onChange(newValue);
  };

  return (
    <div className="autocomplete-container">
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder="Enter request (eg.: name == 'Ivan')..."
        style={{ width: '100%', padding: '8px', fontSize: '14px' }}
      />
      {suggestions.length > 0 && (
        <ul
          style={{
            border: '1px solid #ddd',
            marginTop: '4px',
            padding: '8px',
            backgroundColor: '#fff',
            maxHeight: '150px',
            overflowY: 'auto',
          }}
        >
          {suggestions.map((suggestion, idx) => (
            <li
              key={idx}
              onClick={() => insertSuggestion(suggestion)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                borderBottom: '1px dashed #eee',
              }}
            >
              <strong>{suggestion.split(' ')[0]}</strong>{' '}
              <span style={{ color: '#555' }}>
                {suggestion.split(' ').slice(1).join(' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: '8px', color: '#777', fontSize: '12px' }}>
        {/* AI sucks - dont need show it, should suggest depending on column type */}
        {/* <p>Доступные операции: <code>== != > < CONTAINS</code></p>
        <p>Можно использовать: <code>AND</code>, <code>OR</code>, <code>( )</code></p> */}
      </div>
    </div>
  );
};