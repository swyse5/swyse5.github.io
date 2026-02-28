def convert_names(names):
    """Convert names from 'last, first' to 'first last' format."""
    result = []
    for name in names:
        if ',' in name:
            last, first = name.split(',', 1)
            result.append(f"{first.strip()} {last.strip()}")
        else:
            result.append(name.strip())
    return result


if __name__ == "__main__":
    print("Enter names in 'Last, First' format (one per line).")
    print("Press Enter on an empty line when done:\n")
    
    names = []
    while True:
        line = input()
        if line.strip() == "":
            break
        names.append(line)
    
    if names:
        print("\nConverted names:")
        print("-" * 30)
        for name in convert_names(names):
            print(name)
    else:
        print("No names entered.")
