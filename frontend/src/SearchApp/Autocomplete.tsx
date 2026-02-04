import { useState, useEffect, useRef } from 'react';
import config from '../config';

interface AutocompleteProps {
  fetchSuggestions: (query: string) => Promise<string[]>;
  onSelect: (value: string) => void;
  onChange: (value: string) => void;
  placeholder?: string;
  style: React.CSSProperties
}

const Autocomplete = ({ fetchSuggestions, onSelect, onChange, placeholder, style }: AutocompleteProps) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const DEBOUNCE_DELAY = 300;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    onChange(value);

    if (value.length > 0) {
      setIsLoading(true);
      setTimeout(() => {
        fetchData(value);
      }, DEBOUNCE_DELAY);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const fetchData = async (query: string) => {
    try {
      const results = await fetchSuggestions(query);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (error) {
      console.error('Autocompletion error:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (value: string) => {
    setInputValue(value);
    onChange(value);
    setSuggestions([]);
    setShowSuggestions(false);
    onSelect(value);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="autocomplete-container" ref={containerRef} style={style}>
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        placeholder={placeholder}
        className="autocomplete-input"
      />
      
      {isLoading && (
        <p className="loading">Loading...</p>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <ul className="suggestions-list">
          {suggestions.map((suggestion, index) => (
            <li
              key={index}
              className="suggestion-item"
              onClick={() => handleSuggestionClick(suggestion)}
            >
              <p style={{fontSize: config["FONT_SIZE"]}}>{suggestion}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Autocomplete;
