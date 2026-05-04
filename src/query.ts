export class HunterQuery {
  private parts: string[] = [];

  /**
   * Добавляет условие фильтрации
   * @param field Поле для фильтрации (например, 'web.title' или 'ip.port')
   * @param operator Оператор сравнения (например, '==', '=', '!=')
   * @param value Значение фильтрации
   */
  where(field: string, operator: string, value: string | number): this {
    const safeValue = String(value).replace(/"/g, '\\"');
    this.parts.push(`${field}${operator}"${safeValue}"`);
    return this;
  }

  /**
   * Добавляет короткое условие проверки на равенство (==)
   */
  eq(field: string, value: string | number): this {
    return this.where(field, "==", value);
  }

  /**
   * Логическое И. Можно вызвать как цепочку `.and().where(...)`
   * или с параметрами `.and('ip.port', '==', '80')`
   */
  and(field?: string, operator?: string, value?: string | number): this {
    if (this.parts.length > 0) {
      this.parts.push("and");
    }
    
    if (field && operator && value !== undefined) {
      return this.where(field, operator, value);
    }
    
    return this;
  }

  /**
   * Логическое ИЛИ. Можно вызвать как цепочку `.or().where(...)`
   * или с параметрами `.or('ip.port', '==', '80')`
   */
  or(field?: string, operator?: string, value?: string | number): this {
    if (this.parts.length > 0) {
      this.parts.push("or");
    }

    if (field && operator && value !== undefined) {
      return this.where(field, operator, value);
    }

    return this;
  }

  /**
   * Добавляет кастомную строку в запрос
   */
  raw(queryPart: string): this {
    this.parts.push(queryPart);
    return this;
  }

  /**
   * Собирает итоговый запрос
   */
  build(): string {
    return this.parts.join(" ");
  }
}
